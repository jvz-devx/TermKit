<script lang="ts">
	import { onMount } from 'svelte';
	import StatePanel from '../StatePanel.svelte';
	import RFB, { type RfbClient } from './novnc-rfb';

	type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

	let {
		websocketUrl,
		username,
		password,
		viewOnly = false
	}: {
		websocketUrl?: string;
		username?: string;
		password?: string;
		viewOnly?: boolean;
	} = $props();

	let mountElement: HTMLDivElement;
	let connectionState = $state<ConnectionState>('idle');
	let detail = $state('Waiting for VNC session ticket.');
	let desktopName = $state('VNC');

	onMount(() => {
		let rfb: RfbClient | undefined;
		let resizeObserver: ResizeObserver | undefined;

		if (!websocketUrl) return;

		connectionState = 'connecting';
		detail = 'Opening VNC websocket.';
		rfb = new RFB(mountElement, websocketUrl, {
			shared: true,
			credentials: { username, password }
		});
		rfb.viewOnly = viewOnly;
		rfb.focusOnClick = true;
		rfb.clipViewport = true;
		rfb.dragViewport = true;
		rfb.scaleViewport = true;
		rfb.resizeSession = true;
		rfb.showDotCursor = true;

		rfb.addEventListener('connect', () => {
			connectionState = 'connected';
			detail = 'VNC framebuffer is connected.';
			rfb?.focus();
		});
		rfb.addEventListener('disconnect', () => {
			connectionState = 'disconnected';
			detail = 'VNC session closed.';
		});
		rfb.addEventListener('securityfailure', () => {
			connectionState = 'error';
			detail = 'VNC security negotiation failed.';
		});
		rfb.addEventListener('credentialsrequired', () => {
			if (password) rfb?.sendCredentials({ username, password });
			else {
				connectionState = 'error';
				detail = 'VNC password is required by the target.';
			}
		});
		rfb.addEventListener('desktopname', (event) => {
			desktopName =
				event instanceof CustomEvent && typeof event.detail?.name === 'string'
					? event.detail.name
					: 'VNC';
		});

		resizeObserver = new ResizeObserver(() => {
			rfb!.scaleViewport = true;
			rfb!.resizeSession = true;
		});
		resizeObserver.observe(mountElement);

		return () => {
			resizeObserver?.disconnect();
			rfb?.disconnect();
		};
	});
</script>

<div class="relative h-full min-h-[480px] overflow-hidden rounded-md border bg-black">
	<div
		class="flex h-10 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-400"
	>
		<span class="font-medium text-neutral-100">{desktopName}</span>
		<span>{viewOnly ? 'view only' : 'interactive'}</span>
	</div>
	<div bind:this={mountElement} class="h-[calc(100%-2.5rem)] w-full overflow-hidden"></div>

	{#if connectionState !== 'connected'}
		<StatePanel
			state={connectionState === 'error'
				? 'error'
				: connectionState === 'disconnected'
					? 'disconnected'
					: 'loading'}
			title={connectionState === 'idle' ? 'Session ticket required' : 'VNC not connected'}
			{detail}
			class="absolute right-3 bottom-3 left-3 bg-background"
		/>
	{/if}
</div>
