<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { RdpClipboardPolicy, RdpPerformancePreset } from '$lib/remotes/settings.remote';
	import { createSessionLaunch, type SessionLaunch } from '$lib/remotes/sessions.remote';
	import RdpPane from './RdpPane.svelte';

	let {
		hostId,
		onReconnect,
		clipboardSync = true,
		clipboardPolicy,
		performancePreset = 'balanced',
		audioRedirection = false,
		detailsControls,
		immersive = false,
		sidebarOpen = false,
		onToggleSidebar
	}: {
		hostId: string;
		onReconnect: () => void;
		clipboardSync?: boolean;
		clipboardPolicy?: RdpClipboardPolicy;
		performancePreset?: RdpPerformancePreset;
		audioRedirection?: boolean;
		detailsControls?: Snippet;
		immersive?: boolean;
		sidebarOpen?: boolean;
		onToggleSidebar?: () => void;
	} = $props();

	let launch = $state<SessionLaunch | null>(null);
	let error = $state<string | null>(null);

	onMount(() => {
		let disposed = false;

		void (async () => {
			try {
				const created = await createSessionLaunch({ hostId, protocol: 'rdp' });
				if (disposed) return;
				launch = created;
				error = null;
			} catch (caught) {
				if (disposed) return;
				launch = null;
				error = caught instanceof Error ? caught.message : 'Could not create RDP launch';
			}
		})();

		return () => {
			disposed = true;
		};
	});

	function scrubParentLaunchPassword() {
		if (!launch?.rdpCredentials?.password) return;

		launch = {
			...launch,
			rdpCredentials: {
				...launch.rdpCredentials,
				password: null
			}
		};
	}
</script>

{#key launch?.rdp?.sessionId ?? error ?? 'loading'}
	<RdpPane
		{launch}
		{error}
		{onReconnect}
		onSavedPasswordStaged={scrubParentLaunchPassword}
		{clipboardSync}
		{clipboardPolicy}
		{performancePreset}
		{audioRedirection}
		{detailsControls}
		{immersive}
		{sidebarOpen}
		{onToggleSidebar}
	/>
{/key}
