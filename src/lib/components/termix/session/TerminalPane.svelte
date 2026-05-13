<script lang="ts">
	import '@xterm/xterm/css/xterm.css';
	import { onMount } from 'svelte';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import StatePanel from '../StatePanel.svelte';

	type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

	let {
		title,
		subtitle,
		websocketUrl,
		welcome = []
	}: {
		title: string;
		subtitle: string;
		websocketUrl?: string;
		welcome?: string[];
	} = $props();

	let terminalElement: HTMLDivElement;
	let dimensions = $state('pending');
	let connectionState = $state<ConnectionState>('idle');
	let detail = $state('Waiting for session ticket.');

	onMount(() => {
		const terminal = new Terminal({
			cursorBlink: true,
			fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
			fontSize: 13,
			scrollback: 5000,
			theme: {
				background: '#09090b',
				foreground: '#e4e4e7',
				cursor: '#facc15',
				selectionBackground: '#3f3f46'
			}
		});
		const fitAddon = new FitAddon();
		let socket: WebSocket | undefined;
		let fitTimer: ReturnType<typeof setTimeout> | undefined;

		const fit = () => {
			clearTimeout(fitTimer);
			fitTimer = setTimeout(() => {
				try {
					fitAddon.fit();
					dimensions = `${terminal.cols}x${terminal.rows}`;
				} catch {
					// xterm can briefly be detached while tabs resize.
				}
			}, 40);
		};

		terminal.loadAddon(fitAddon);
		terminal.open(terminalElement);
		terminal.focus();
		fit();

		for (const line of welcome) {
			terminal.writeln(line);
		}

		const resizeObserver = new ResizeObserver(fit);
		resizeObserver.observe(terminalElement);

		if (websocketUrl) {
			connectionState = 'connecting';
			detail = 'Opening websocket session.';
			socket = new WebSocket(websocketUrl);
			socket.binaryType = 'arraybuffer';

			socket.addEventListener('open', () => {
				connectionState = 'connected';
				detail = 'Terminal stream is connected.';
				terminal.focus();
			});
			socket.addEventListener('message', (event) => {
				if (typeof event.data === 'string') terminal.write(event.data);
				else terminal.write(new Uint8Array(event.data));
			});
			socket.addEventListener('close', () => {
				connectionState = 'disconnected';
				detail = 'Terminal stream closed.';
			});
			socket.addEventListener('error', () => {
				connectionState = 'error';
				detail = 'Terminal websocket failed.';
			});
			terminal.onData((data) => socket?.readyState === WebSocket.OPEN && socket.send(data));
		}

		return () => {
			clearTimeout(fitTimer);
			resizeObserver.disconnect();
			socket?.close();
			terminal.dispose();
		};
	});
</script>

<div class="flex h-full min-h-[480px] flex-col overflow-hidden rounded-md border bg-zinc-950">
	<div
		class="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-3 text-xs text-zinc-400"
	>
		<div class="min-w-0">
			<span class="font-medium text-zinc-100">{title}</span>
			<span class="ml-2 font-mono">{subtitle}</span>
		</div>
		<span class="font-mono">{dimensions}</span>
	</div>

	<div class="relative min-h-0 flex-1">
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
	</div>
</div>
