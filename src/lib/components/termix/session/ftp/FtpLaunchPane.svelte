<script lang="ts">
	import { onMount } from 'svelte';
	import { RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		createSessionLaunch,
		type HostSummary,
		type SessionLaunch
	} from '$lib/remotes/sessions.remote';
	import { failureCopy, failureDetail } from '$lib/termix/failure-copy';
	import StatePanel from '../../StatePanel.svelte';
	import SftpBrowser from '../sftp/SftpBrowser.svelte';

	let { host }: { host: HostSummary } = $props();

	let launch = $state<SessionLaunch | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let lifecycleRecorded = false;
	const label = $derived(host.protocol === 'ftps' ? 'FTPS' : 'FTP');
	let errorCopy = $derived(error ? failureCopy({ protocol: host.protocol, message: error }) : null);

	function recordEnded(connectionSessionId: string | null | undefined) {
		if (!connectionSessionId || lifecycleRecorded) return;
		lifecycleRecorded = true;

		const payload = JSON.stringify({ connectionSessionId, event: 'ended' });
		const endpoint = '/api/connection-sessions/lifecycle';
		const body = new Blob([payload], { type: 'application/json' });
		if (navigator.sendBeacon?.(endpoint, body)) return;

		void fetch(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: payload,
			keepalive: true
		});
	}

	async function createLaunch(cancelled: () => boolean = () => false) {
		loading = true;
		error = null;
		launch = null;
		lifecycleRecorded = false;
		try {
			const created = await createSessionLaunch({ hostId: host.id, protocol: host.protocol });
			if (!cancelled()) {
				launch = created;
				return;
			}

			if (created.connectionSessionId) recordEnded(created.connectionSessionId);
		} catch (caught) {
			if (!cancelled())
				error = caught instanceof Error ? caught.message : `Could not start ${label}`;
		} finally {
			if (!cancelled()) loading = false;
		}
	}

	onMount(() => {
		let cancelled = false;
		const handlePageHide = () => recordEnded(launch?.connectionSessionId);
		window.addEventListener('pagehide', handlePageHide);

		void createLaunch(() => cancelled);

		return () => {
			cancelled = true;
			window.removeEventListener('pagehide', handlePageHide);
			recordEnded(launch?.connectionSessionId);
		};
	});
</script>

{#if error}
	<StatePanel
		state="error"
		title={errorCopy?.title ?? `Could not start ${label}`}
		detail={`${errorCopy ? failureDetail(errorCopy) : `Retry the ${label} session.`} Diagnostic: ${errorCopy?.diagnostic ?? error}`}
	>
		<Button size="sm" onclick={() => createLaunch()} disabled={loading}>
			<RotateCcw class="size-4" />
			Retry {label}
		</Button>
	</StatePanel>
{:else if launch}
	<SftpBrowser hostId={host.id} apiBase="ftp" {label} initialPath="/" />
{:else}
	<StatePanel
		state="loading"
		title={`Preparing ${label} session`}
		detail="Creating a connection session."
	/>
{/if}
