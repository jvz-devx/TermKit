<script lang="ts">
	import { onMount } from 'svelte';
	import { createSessionLaunch, type SessionLaunch } from '$lib/termix.remote';
	import StatePanel from '../StatePanel.svelte';
	import SftpBrowser from './SftpBrowser.svelte';

	let { hostId }: { hostId: string } = $props();

	let launch = $state<SessionLaunch | null>(null);
	let error = $state<string | null>(null);
	let lifecycleRecorded = false;

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

	onMount(() => {
		let cancelled = false;
		const handlePageHide = () => recordEnded(launch?.connectionSessionId);
		window.addEventListener('pagehide', handlePageHide);

		async function createLaunch() {
			try {
				const created = await createSessionLaunch({ hostId, protocol: 'sftp' });
				if (!cancelled) {
					launch = created;
					return;
				}

				if (created.connectionSessionId) {
					recordEnded(created.connectionSessionId);
				}
			} catch (caught) {
				if (!cancelled) {
					error = caught instanceof Error ? caught.message : 'Could not start SFTP';
				}
			}
		}

		void createLaunch();

		return () => {
			cancelled = true;
			window.removeEventListener('pagehide', handlePageHide);
			recordEnded(launch?.connectionSessionId);
		};
	});
</script>

{#if error}
	<StatePanel state="error" title="Could not start SFTP" detail={error} />
{:else if launch}
	<SftpBrowser {hostId} initialPath="/" />
{:else}
	<StatePanel
		state="loading"
		title="Preparing SFTP session"
		detail="Creating a connection session."
	/>
{/if}
