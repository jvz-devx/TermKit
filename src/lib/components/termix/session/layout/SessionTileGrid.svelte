<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import SessionPaneTree from './SessionPaneTree.svelte';
	import { createPaneTreeForLayout } from './workspace-layout';
	import type {
		SessionLayoutKind,
		SessionPaneTreeNode,
		SessionWorkspacePane
	} from './workspace-layout';

	let {
		layout,
		panes,
		tree,
		immersive = false,
		children: renderPane
	}: {
		layout: SessionLayoutKind;
		panes: SessionWorkspacePane[];
		tree?: SessionPaneTreeNode;
		immersive?: boolean;
		children: Snippet<[SessionWorkspacePane, number]>;
	} = $props();

	let desktop = $state(browser ? window.matchMedia('(min-width: 1024px)').matches : false);
	let activeTree = $derived(tree ?? createPaneTreeForLayout(layout, panes));

	onMount(() => {
		const media = window.matchMedia('(min-width: 1024px)');
		const sync = () => (desktop = media.matches);
		sync();
		media.addEventListener('change', sync);
		return () => media.removeEventListener('change', sync);
	});

	function storageKey(suffix: string) {
		return [
			'termkit-session-layout',
			layout,
			desktop ? 'desktop' : 'compact',
			paneKey(),
			suffix
		].join(':');
	}

	function paneKey() {
		return panes.map((pane) => pane.id).join('-');
	}
</script>

<div
	class={immersive
		? 'h-full min-h-0 w-full min-w-0 flex-1 p-0'
		: 'h-full min-h-0 w-full min-w-0 flex-1 p-2'}
>
	<SessionPaneTree tree={activeTree} {panes} {desktop} {immersive} {storageKey}>
		{#snippet children(pane, index)}
			{@render renderPane(pane, index)}
		{/snippet}
	</SessionPaneTree>
</div>
