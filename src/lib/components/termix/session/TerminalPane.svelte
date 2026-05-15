<script lang="ts">
	import '@xterm/xterm/css/xterm.css';
	import { onMount } from 'svelte';
	import {
		ChevronDown,
		ChevronUp,
		Download,
		History,
		Radio,
		Search,
		Square,
		X
	} from '@lucide/svelte';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { TerminalPreferences } from '$lib/termix/host-metadata';
	import StatePanel from '../StatePanel.svelte';
	import { nextCommandHistory, terminalSnippets, updateCommandDraft } from './terminal-helpers';
	import {
		appendTerminalRecordingFrame,
		buildTerminalRecordingCast,
		createTerminalRecordingId,
		pruneTerminalRecordingMetadata,
		rememberTerminalRecording,
		terminalRecordingBytes,
		terminalRecordingExpiresAt,
		type TerminalRecordingFrame
	} from './terminal-recording';

	type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
	type TerminalResizeFrame = { type: 'terminal.resize'; cols: number; rows: number };
	type SearchMatch = { line: number; text: string };

	let {
		title,
		subtitle,
		websocketUrl,
		welcome = [],
		fontSize = 13,
		preferences,
		onConnectionStateChange
	}: {
		title: string;
		subtitle: string;
		websocketUrl?: string;
		welcome?: string[];
		fontSize?: number;
		preferences?: TerminalPreferences;
		onConnectionStateChange?: (state: ConnectionState) => void;
	} = $props();

	let terminalElement: HTMLDivElement;
	let dimensions = $state('pending');
	let connectionState = $state<ConnectionState>('idle');
	let detail = $state('Waiting for session ticket.');
	let searchOpen = $state(false);
	let searchTerm = $state('');
	let searchMatches = $state<SearchMatch[]>([]);
	let searchIndex = $state(-1);
	let recordingActive = $state(false);
	let recordingFrames = $state<TerminalRecordingFrame[]>([]);
	let recordingStartedAt = $state<Date | null>(null);
	let recordingLastBlob = $state<Blob | null>(null);
	let recordingLastName = $state<string | null>(null);
	let localCommandDraft = '';
	let commandHistory = $state<string[]>([]);
	let terminal: Terminal | null = null;
	let socketRef: WebSocket | undefined;
	const textEncoder = new TextEncoder();
	let resolvedFontSize = $derived(preferences?.fontSize ?? fontSize);
	let resolvedScrollback = $derived(preferences?.scrollback ?? 5000);
	let resolvedCursorBlink = $derived(preferences?.cursorBlink ?? true);
	let resolvedTheme = $derived(preferences?.theme ?? 'dark');
	let recordingBytes = $derived(terminalRecordingBytes(recordingFrames));

	onMount(() => {
		const instance = new Terminal({
			cursorBlink: resolvedCursorBlink,
			fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
			fontSize: resolvedFontSize,
			scrollback: resolvedScrollback,
			theme: terminalTheme(resolvedTheme)
		});
		const fitAddon = new FitAddon();
		let fitTimer: ReturnType<typeof setTimeout> | undefined;

		const fit = () => {
			clearTimeout(fitTimer);
			fitTimer = setTimeout(() => {
				try {
					fitAddon.fit();
					dimensions = `${instance.cols}x${instance.rows}`;
				} catch {
					// xterm can briefly be detached while tabs resize.
				}
			}, 40);
		};

		instance.loadAddon(fitAddon);
		instance.open(terminalElement);
		terminal = instance;
		instance.focus();
		fit();
		pruneLocalTerminalRecordings();

		for (const line of welcome) {
			instance.writeln(line);
		}

		const resizeObserver = new ResizeObserver(fit);
		resizeObserver.observe(terminalElement);
		let dataDisposable: { dispose: () => void } | undefined;
		let resizeDisposable: { dispose: () => void } | undefined;

		if (!websocketUrl) {
			setConnectionState('idle', 'Waiting for session ticket.');
		} else {
			setConnectionState('connecting', 'Opening websocket session.');

			socketRef = new WebSocket(websocketUrl);
			socketRef.binaryType = 'arraybuffer';

			dataDisposable = instance.onData((data) => {
				rememberLocalCommandInput(data);
				writeToSocket(data);
			});
			resizeDisposable = instance.onResize((size) => socketRef && sendResize(socketRef, size));

			socketRef.addEventListener('open', () => {
				if (!socketRef || socketRef.readyState !== WebSocket.OPEN) return;
				setConnectionState('connected', 'Terminal stream is connected.');
				sendResize(socketRef, { cols: instance.cols, rows: instance.rows });
				instance.focus();
			});
			socketRef.addEventListener('message', (event) => {
				if (typeof event.data === 'string') {
					recordTerminalOutput(event.data);
					instance.write(event.data);
				} else {
					const bytes = new Uint8Array(event.data);
					recordTerminalOutput(bytes);
					instance.write(bytes);
				}
			});
			socketRef.addEventListener('close', (event) => {
				setConnectionState('disconnected', closeDetail(event.reason));
			});
			socketRef.addEventListener('error', () => {
				setConnectionState('error', 'Terminal websocket failed.');
			});
		}

		return () => {
			clearTimeout(fitTimer);
			resizeObserver.disconnect();
			dataDisposable?.dispose();
			resizeDisposable?.dispose();
			socketRef?.close();
			socketRef = undefined;
			terminal = null;
			instance.dispose();
		};
	});

	function rememberLocalCommandInput(data: string) {
		const nextDraft = updateCommandDraft(localCommandDraft, data);
		if (nextDraft === '' && localCommandDraft.trim()) {
			commandHistory = nextCommandHistory(commandHistory, localCommandDraft);
		}
		localCommandDraft = nextDraft;
	}

	function writeToSocket(data: string) {
		if (socketRef?.readyState === WebSocket.OPEN) socketRef.send(textEncoder.encode(data));
	}

	function runSnippet(command: string) {
		writeToSocket(`${command}\r`);
		commandHistory = nextCommandHistory(commandHistory, command);
		terminal?.focus();
	}

	function rerunCommand(command: string) {
		writeToSocket(`${command}\r`);
		terminal?.focus();
	}

	function startRecording() {
		recordingStartedAt = new Date();
		recordingFrames = [];
		recordingLastBlob = null;
		recordingLastName = null;
		recordingActive = true;
		terminal?.focus();
	}

	function stopRecording() {
		if (!recordingStartedAt) return;
		const endedAt = new Date();
		const blob = buildTerminalRecordingCast({
			width: terminal?.cols ?? 80,
			height: terminal?.rows ?? 24,
			startedAt: recordingStartedAt,
			title,
			frames: recordingFrames
		});
		const id = createTerminalRecordingId(recordingStartedAt);
		const fileName = `${id}.cast`;
		recordingActive = false;
		recordingLastBlob = blob;
		recordingLastName = fileName;
		rememberLocalTerminalRecording({
			id,
			title,
			startedAt: recordingStartedAt.toISOString(),
			endedAt: endedAt.toISOString(),
			expiresAt: terminalRecordingExpiresAt(recordingStartedAt, 7).toISOString(),
			bytes: blob.size
		});
		downloadRecording(blob, fileName);
	}

	function recordTerminalOutput(data: string | Uint8Array) {
		if (!recordingActive || !recordingStartedAt) return;
		recordingFrames = appendTerminalRecordingFrame(
			recordingFrames,
			recordingStartedAt.getTime(),
			data
		);
	}

	function downloadLastRecording() {
		if (!recordingLastBlob || !recordingLastName) return;
		downloadRecording(recordingLastBlob, recordingLastName);
	}

	function downloadRecording(blob: Blob, fileName: string) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.rel = 'noopener';
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	}

	function pruneLocalTerminalRecordings() {
		if (typeof localStorage === 'undefined') return;
		pruneTerminalRecordingMetadata(localStorage);
	}

	function rememberLocalTerminalRecording(
		recording: Parameters<typeof rememberTerminalRecording>[1]
	) {
		if (typeof localStorage === 'undefined') return;
		rememberTerminalRecording(localStorage, recording);
	}

	function refreshSearch() {
		const instance = terminal;
		const needle = searchTerm.trim().toLowerCase();
		if (!instance || !needle) {
			searchMatches = [];
			searchIndex = -1;
			return;
		}

		const buffer = instance.buffer.active;
		const matches: SearchMatch[] = [];
		for (let index = 0; index < buffer.length; index += 1) {
			const line = buffer.getLine(index)?.translateToString(true) ?? '';
			if (line.toLowerCase().includes(needle)) {
				matches.push({ line: index, text: line.trim() || '(blank line)' });
			}
		}

		searchMatches = matches;
		searchIndex = matches.length ? 0 : -1;
		scrollToSearchMatch();
	}

	function moveSearch(direction: 1 | -1) {
		if (!searchMatches.length) return;
		searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
		scrollToSearchMatch();
	}

	function scrollToSearchMatch() {
		const match = searchMatches[searchIndex];
		if (!terminal || !match) return;
		terminal.scrollToLine(match.line);
		terminal.focus();
	}

	function sendResize(socket: WebSocket, size: { cols: number; rows: number }) {
		if (socket.readyState !== WebSocket.OPEN) return;
		const frame: TerminalResizeFrame = {
			type: 'terminal.resize',
			cols: size.cols,
			rows: size.rows
		};
		socket.send(JSON.stringify(frame));
	}

	function setConnectionState(state: ConnectionState, nextDetail: string) {
		connectionState = state;
		detail = nextDetail;
		onConnectionStateChange?.(state);
	}

	function closeDetail(reason: string) {
		if (reason.includes('host key')) {
			return 'SSH host key is not trusted. Enroll the host key before reconnecting.';
		}
		if (reason.includes('target connection failed')) {
			return 'Target connection failed. Check the host, port, firewall, and target service before reconnecting.';
		}
		if (reason.includes('protocol adapter failed')) {
			return 'Terminal bridge failed while starting the protocol adapter. Retry and check server logs if it repeats.';
		}
		return reason || 'Terminal stream closed.';
	}

	function terminalTheme(theme: TerminalPreferences['theme']) {
		if (theme === 'light') {
			return {
				background: '#fafafa',
				foreground: '#18181b',
				cursor: '#ca8a04',
				selectionBackground: '#d4d4d8'
			};
		}

		return {
			background: '#09090b',
			foreground: '#e4e4e7',
			cursor: '#facc15',
			selectionBackground: '#3f3f46'
		};
	}
</script>

<div class="flex h-full min-h-[480px] flex-col overflow-hidden rounded-md border bg-zinc-950">
	<div
		class="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-3 text-xs text-zinc-400"
	>
		<div class="min-w-0 truncate">
			<span class="font-medium text-zinc-100">{title}</span>
			<span class="ml-2 font-mono">{subtitle}</span>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			<Badge variant="outline" class="border-zinc-700 font-mono text-zinc-300">{dimensions}</Badge>
			<Button
				size="icon-sm"
				variant={searchOpen ? 'secondary' : 'ghost'}
				aria-label="Search terminal scrollback"
				class="text-zinc-200 hover:bg-zinc-800"
				onclick={() => (searchOpen = !searchOpen)}
			>
				<Search class="size-4" />
			</Button>
		</div>
	</div>

	<div class="relative min-h-0 flex-1">
		{#if searchOpen}
			<div
				class="absolute top-3 right-3 left-3 z-10 grid gap-2 rounded-md border border-zinc-800 bg-zinc-950/95 p-2 shadow-lg backdrop-blur md:grid-cols-[minmax(0,1fr)_auto_auto]"
			>
				<div class="relative">
					<Search class="absolute top-2 left-2 size-4 text-zinc-500" />
					<Input
						class="h-8 border-zinc-800 bg-zinc-900 pl-8 font-mono text-xs text-zinc-100"
						placeholder="Search scrollback"
						bind:value={searchTerm}
						onkeydown={(event) => {
							if (event.key === 'Enter') refreshSearch();
							if (event.key === 'Escape') searchOpen = false;
						}}
					/>
				</div>
				<div class="flex items-center gap-1">
					<Button size="sm" variant="outline" class="h-8" onclick={refreshSearch}>Find</Button>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Previous match"
						disabled={!searchMatches.length}
						onclick={() => moveSearch(-1)}
					>
						<ChevronUp class="size-4" />
					</Button>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Next match"
						disabled={!searchMatches.length}
						onclick={() => moveSearch(1)}
					>
						<ChevronDown class="size-4" />
					</Button>
				</div>
				<div class="flex items-center justify-between gap-2 text-xs text-zinc-400">
					<span class="font-mono">
						{searchMatches.length
							? `${searchIndex + 1}/${searchMatches.length}`
							: searchTerm.trim()
								? 'No matches'
								: 'Ready'}
					</span>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Close search"
						onclick={() => (searchOpen = false)}
					>
						<X class="size-4" />
					</Button>
				</div>
			</div>
		{/if}
		<div bind:this={terminalElement} class="h-full w-full p-2"></div>
		{#if connectionState !== 'connected'}
			<StatePanel
				state={connectionState === 'error'
					? 'error'
					: connectionState === 'disconnected'
						? 'disconnected'
						: 'loading'}
				title={connectionState === 'idle' ? 'Session ticket required' : 'Terminal not connected'}
				{detail}
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		{/if}
		<div
			class="absolute right-3 bottom-3 left-3 flex flex-wrap items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/90 p-1.5 text-xs shadow-lg"
		>
			<Button
				size="sm"
				variant={recordingActive ? 'destructive' : 'ghost'}
				class="h-7 px-2 font-mono text-zinc-200 hover:bg-zinc-800"
				disabled={connectionState !== 'connected' && !recordingActive}
				title={recordingActive
					? 'Stop terminal recording and download the cast file'
					: 'Start terminal recording; output is kept in this browser until downloaded'}
				onclick={recordingActive ? stopRecording : startRecording}
			>
				{#if recordingActive}
					<Square class="size-3.5" />
					Stop rec
				{:else}
					<Radio class="size-3.5" />
					Record
				{/if}
			</Button>
			{#if recordingActive}
				<Badge variant="outline" class="border-zinc-700 font-mono text-zinc-300">
					{Math.ceil(recordingBytes / 1024)} KB
				</Badge>
			{:else if recordingLastBlob}
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Download last terminal recording"
					class="text-zinc-200 hover:bg-zinc-800"
					onclick={downloadLastRecording}
				>
					<Download class="size-4" />
				</Button>
			{/if}
			{#each terminalSnippets as snippet (snippet.id)}
				<Button
					size="sm"
					variant="ghost"
					class="h-7 px-2 font-mono text-zinc-200 hover:bg-zinc-800"
					disabled={connectionState !== 'connected'}
					onclick={() => runSnippet(snippet.command)}
				>
					{snippet.label}
				</Button>
			{/each}
			{#if commandHistory.length}
				<div class="ml-auto flex min-w-0 items-center gap-1">
					<History class="size-4 text-zinc-500" />
					{#each commandHistory.slice(0, 3) as command (command)}
						<Button
							size="sm"
							variant="ghost"
							class="h-7 max-w-36 truncate px-2 font-mono text-zinc-300 hover:bg-zinc-800"
							disabled={connectionState !== 'connected'}
							onclick={() => rerunCommand(command)}
						>
							{command}
						</Button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
