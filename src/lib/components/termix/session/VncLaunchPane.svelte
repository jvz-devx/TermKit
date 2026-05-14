<script lang="ts">
	import { onMount } from 'svelte';
	import { createSessionLaunch, type SessionLaunch } from '$lib/termix.remote';
	import StatePanel from '../StatePanel.svelte';
	import VncPane from './VncPane.svelte';

	let { hostId, fallbackUsername }: { hostId: string; fallbackUsername: string | null } = $props();

	let launch = $state<SessionLaunch | null>(null);
	let error = $state<string | null>(null);

	onMount(() => {
		let disposed = false;

		void (async () => {
			try {
				const created = await createSessionLaunch({ hostId, protocol: 'vnc' });
				if (disposed) return;
				launch = created;
				error = null;
			} catch (caught) {
				if (disposed) return;
				launch = null;
				error = caught instanceof Error ? caught.message : 'Could not create VNC launch';
			}
		})();

		return () => {
			disposed = true;
		};
	});

	function scrubParentLaunchPassword() {
		if (!launch?.vncCredentials?.password) return;

		launch = {
			...launch,
			vncCredentials: {
				...launch.vncCredentials,
				password: null
			}
		};
	}

	function toWebSocketUrl(path: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}${path}`;
	}
</script>

{#key launch?.ticket ?? error ?? 'loading'}
	{#if error}
		<StatePanel state="error" title="Session launch failed" detail={error} />
	{:else}
		<VncPane
			websocketUrl={launch?.websocketPath ? toWebSocketUrl(launch.websocketPath) : undefined}
			credentials={{
				username: launch?.vncCredentials?.username ?? fallbackUsername,
				password: launch?.vncCredentials?.password ?? null
			}}
			credentialStrategy={launch?.vncCredentials?.source ?? 'none'}
			onSavedPasswordStaged={scrubParentLaunchPassword}
		/>
	{/if}
{/key}
