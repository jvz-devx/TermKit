<script lang="ts">
	import { onMount } from 'svelte';
	import { createSessionLaunch, type SessionLaunch } from '$lib/termix.remote';
	import StatePanel from '../StatePanel.svelte';
	import TerminalPane from './TerminalPane.svelte';

	let {
		hostId,
		hostname,
		port,
		fontSize
	}: { hostId: string; hostname: string; port: number; fontSize: number } = $props();

	let launch = $state<SessionLaunch | null>(null);
	let error = $state<string | null>(null);

	onMount(() => {
		let disposed = false;

		void (async () => {
			try {
				const created = await createSessionLaunch({ hostId, protocol: 'telnet' });
				if (disposed) return;
				launch = created;
				error = null;
			} catch (caught) {
				if (disposed) return;
				launch = null;
				error = caught instanceof Error ? caught.message : 'Could not create Telnet launch';
			}
		})();

		return () => {
			disposed = true;
		};
	});

	function toWebSocketUrl(path: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}${path}`;
	}
</script>

{#if error}
	<StatePanel state="error" title="Session launch failed" detail={error} />
{:else if launch}
	<TerminalPane
		title="Telnet terminal"
		subtitle={`${hostname}:${port}`}
		websocketUrl={launch.websocketPath ? toWebSocketUrl(launch.websocketPath) : undefined}
		welcome={[`Trying ${hostname}...`, 'Opening websocket bridge...', '']}
		{fontSize}
	/>
{:else}
	<StatePanel state="loading" title="Opening Telnet" detail="Creating a session ticket." />
{/if}
