<script lang="ts">
	import { onMount } from 'svelte';
	import { createLiveSshSession, type HostSummary, type LiveSshAttach } from '$lib/termix.remote';
	import StatePanel from '../StatePanel.svelte';
	import TerminalPane from './TerminalPane.svelte';

	let {
		host,
		fontSize,
		onLaunch,
		onConnectionStateChange
	}: {
		host: HostSummary;
		fontSize: number;
		onLaunch?: (launch: LiveSshAttach) => void;
		onConnectionStateChange?: (
			state: 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'
		) => void;
	} = $props();

	let launch = $state<LiveSshAttach | null>(null);
	let error = $state<string | null>(null);

	onMount(() => {
		let cancelled = false;

		void createLiveSshSession({
			hostId: host.id,
			title: host.name,
			cols: 80,
			rows: 24
		})
			.then((created) => {
				if (cancelled) return;
				launch = created;
				onLaunch?.(created);
			})
			.catch((caught: unknown) => {
				if (cancelled) return;
				error = caught instanceof Error ? caught.message : 'Could not create live SSH session';
			});

		return () => {
			cancelled = true;
		};
	});

	function toWebSocketUrl(path: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}${path}`;
	}
</script>

{#if error}
	<StatePanel state="error" title="SSH tab launch failed" detail={error} />
{:else if launch}
	<TerminalPane
		title={launch.session.title}
		subtitle={`${launch.session.username ?? 'user'}@${launch.session.hostname}`}
		websocketUrl={toWebSocketUrl(launch.liveWebsocketPath)}
		welcome={[`$ ssh ${launch.session.hostname}`, 'Attaching live SSH session...', '']}
		{fontSize}
		{onConnectionStateChange}
	/>
{:else}
	<StatePanel
		state="loading"
		title="Opening SSH tab"
		detail="Creating a live session attach ticket."
	/>
{/if}
