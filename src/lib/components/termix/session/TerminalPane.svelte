<script lang="ts">
	import '@xterm/xterm/css/xterm.css';
	import { onMount } from 'svelte';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import StatePanel from '../StatePanel.svelte';

	type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
	type TerminalResizeFrame = { type: 'terminal.resize'; cols: number; rows: number };

	let {
		title,
		subtitle,
		websocketUrl,
		welcome = [],
		fontSize = 13,
		onConnectionStateChange
	}: {
		title: string;
		subtitle: string;
		websocketUrl?: string;
		welcome?: string[];
		fontSize?: number;
		onConnectionStateChange?: (state: ConnectionState) => void;
	} = $props();

	let terminalElement: HTMLDivElement;
	let dimensions = $state('pending');
	let connectionState = $state<ConnectionState>('idle');
	let detail = $state('Waiting for session ticket.');
	const textEncoder = new TextEncoder();

	onMount(() => {
		const instance = new Terminal({
			cursorBlink: true,
			fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
			fontSize,
			scrollback: 5000,
			theme: {
				background: '#09090b',
				foreground: '#e4e4e7',
				cursor: '#facc15',
				selectionBackground: '#3f3f46'
			}
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
		instance.focus();
		fit();

		for (const line of welcome) {
			instance.writeln(line);
		}

		const resizeObserver = new ResizeObserver(fit);
		resizeObserver.observe(terminalElement);
		let socket: WebSocket | undefined;
		let dataDisposable: { dispose: () => void } | undefined;
		let resizeDisposable: { dispose: () => void } | undefined;

		if (!websocketUrl) {
			setConnectionState('idle', 'Waiting for session ticket.');
		} else {
			setConnectionState('connecting', 'Opening websocket session.');

			socket = new WebSocket(websocketUrl);
			socket.binaryType = 'arraybuffer';

			dataDisposable = instance.onData((data) => {
				if (socket?.readyState === WebSocket.OPEN) socket.send(textEncoder.encode(data));
			});
			resizeDisposable = instance.onResize((size) => socket && sendResize(socket, size));

			socket.addEventListener('open', () => {
				if (!socket || socket.readyState !== WebSocket.OPEN) return;
				setConnectionState('connected', 'Terminal stream is connected.');
				sendResize(socket, { cols: instance.cols, rows: instance.rows });
				instance.focus();
			});
			socket.addEventListener('message', (event) => {
				if (typeof event.data === 'string') instance.write(event.data);
				else instance.write(new Uint8Array(event.data));
			});
			socket.addEventListener('close', () => {
				setConnectionState('disconnected', 'Terminal stream closed.');
			});
			socket.addEventListener('error', () => {
				setConnectionState('error', 'Terminal websocket failed.');
			});
		}

		return () => {
			clearTimeout(fitTimer);
			resizeObserver.disconnect();
			dataDisposable?.dispose();
			resizeDisposable?.dispose();
			socket?.close();
			instance.dispose();
		};
	});

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
