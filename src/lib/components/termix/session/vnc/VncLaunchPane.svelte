<script lang="ts">
	import { onMount } from 'svelte';
	import { RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { createSessionLaunch, type SessionLaunch } from '$lib/remotes/sessions.remote';
	import { failureCopy, failureDetail } from '$lib/termix/failure-copy';
	import StatePanel from '../../StatePanel.svelte';
	import VncPane from './VncPane.svelte';

	let { hostId, fallbackUsername }: { hostId: string; fallbackUsername: string | null } = $props();

	let launch = $state<SessionLaunch | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let errorCopy = $derived(error ? failureCopy({ protocol: 'vnc', message: error }) : null);

	async function createLaunch(disposed: () => boolean = () => false) {
		loading = true;
		launch = null;
		error = null;
		try {
			const created = await createSessionLaunch({ hostId, protocol: 'vnc' });
			if (disposed()) return;
			launch = created;
		} catch (caught) {
			if (disposed()) return;
			error = caught instanceof Error ? caught.message : 'Could not create VNC launch';
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
		<StatePanel
			state="error"
			title={errorCopy?.title ?? 'VNC launch failed'}
			detail={`${errorCopy ? failureDetail(errorCopy) : 'Retry the VNC launch.'} Diagnostic: ${errorCopy?.diagnostic ?? error}`}
		>
			<Button size="sm" onclick={() => createLaunch()} disabled={loading}>
				<RotateCcw class="size-4" />
				Retry VNC
			</Button>
		</StatePanel>
	{:else if launch}
		<VncPane
			websocketUrl={launch?.websocketPath ? toWebSocketUrl(launch.websocketPath) : undefined}
			credentials={{
				username: launch?.vncCredentials?.username ?? fallbackUsername,
				password: launch?.vncCredentials?.password ?? null
			}}
			credentialStrategy={launch?.vncCredentials?.source ?? 'none'}
			onSavedPasswordStaged={scrubParentLaunchPassword}
		/>
	{:else}
		<StatePanel state="loading" title="Opening VNC" detail="Creating a session ticket." />
	{/if}
{/key}
