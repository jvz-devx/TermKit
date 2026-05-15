<script lang="ts">
	import { onMount } from 'svelte';
	import { RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { createLiveSshSession, type HostSummary, type LiveSshAttach } from '$lib/termix.remote';
	import { failureCopy, failureDetail } from '$lib/termix/failure-copy';
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
	let loading = $state(true);
	let errorCopy = $derived(error ? failureCopy({ protocol: 'ssh', message: error }) : null);

	async function openSshTab(cancelled: () => boolean = () => false) {
		loading = true;
		error = null;
		launch = null;
		try {
			const created = await createLiveSshSession({
				hostId: host.id,
				title: host.name,
				cols: 80,
				rows: 24
			});
			if (cancelled()) return;
			launch = created;
			onLaunch?.(created);
		} catch (caught) {
			if (cancelled()) return;
			error = caught instanceof Error ? caught.message : 'Could not create live SSH session';
		} finally {
			if (!cancelled()) loading = false;
		}
	}

	onMount(() => {
		let cancelled = false;
		void openSshTab(() => cancelled);

		return () => {
			cancelled = true;
		};
	});

	function toWebSocketUrl(path: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}${path}`;
	}

	let welcome = $derived([
		`$ ssh ${host.hostname}`,
		host.sshJumpHost.enabled && host.sshJumpHost.hostId
			? `Using jump host ${host.sshJumpHost.hostId}`
			: 'Direct SSH target',
		'Attaching live SSH session...',
		''
	]);
</script>

{#if error}
	<StatePanel
		state="error"
		title={errorCopy?.title ?? 'SSH tab launch failed'}
		detail={`${errorCopy ? failureDetail(errorCopy) : 'Retry the SSH launch.'} Diagnostic: ${errorCopy?.diagnostic ?? error}`}
	>
		<Button size="sm" onclick={() => openSshTab()} disabled={loading}>
			<RotateCcw class="size-4" />
			Retry SSH
		</Button>
	</StatePanel>
{:else if launch}
	<TerminalPane
		title={launch.session.title}
		subtitle={`${launch.session.username ?? 'user'}@${launch.session.hostname}`}
		websocketUrl={toWebSocketUrl(launch.liveWebsocketPath)}
		{welcome}
		{fontSize}
		preferences={host.terminalPreferences}
		{onConnectionStateChange}
	/>
{:else}
	<StatePanel
		state="loading"
		title="Opening SSH tab"
		detail="Creating a live session attach ticket."
	/>
{/if}
