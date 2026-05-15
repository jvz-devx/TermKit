<script lang="ts">
	import { onMount } from 'svelte';
	import { RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { createSessionLaunch, type SessionLaunch } from '$lib/termix.remote';
	import { failureCopy, failureDetail } from '$lib/termix/failure-copy';
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
	let loading = $state(true);
	let errorCopy = $derived(error ? failureCopy({ protocol: 'telnet', message: error }) : null);

	async function createLaunch(disposed: () => boolean = () => false) {
		loading = true;
		launch = null;
		error = null;
		try {
			const created = await createSessionLaunch({ hostId, protocol: 'telnet' });
			if (disposed()) return;
			launch = created;
		} catch (caught) {
			if (disposed()) return;
			error = caught instanceof Error ? caught.message : 'Could not create Telnet launch';
		} finally {
			if (!disposed()) loading = false;
		}
	}

	onMount(() => {
		let disposed = false;
		void createLaunch(() => disposed);

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
	<StatePanel
		state="error"
		title={errorCopy?.title ?? 'Telnet launch failed'}
		detail={`${errorCopy ? failureDetail(errorCopy) : 'Retry the Telnet launch.'} Diagnostic: ${errorCopy?.diagnostic ?? error}`}
	>
		<Button size="sm" onclick={() => createLaunch()} disabled={loading}>
			<RotateCcw class="size-4" />
			Retry Telnet
		</Button>
	</StatePanel>
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
