<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import Self from './SessionPaneTree.svelte';
	import type { SessionPaneTreeNode, SessionWorkspacePane } from './workspace-layout';

	let {
		tree,
		panes,
		path = 'root',
		desktop = true,
		immersive = false,
		storageKey,
		children
	}: {
		tree: SessionPaneTreeNode;
		panes: SessionWorkspacePane[];
		path?: string;
		desktop?: boolean;
		immersive?: boolean;
		storageKey: (suffix: string) => string;
		children: Snippet<[SessionWorkspacePane, number]>;
	} = $props();

	let paneById = $derived(new Map(panes.map((pane, index) => [pane.id, { pane, index }])));

	function paneMinSize() {
		return desktop ? 18 : 14;
	}

	function groupDirection(direction: 'horizontal' | 'vertical') {
		return desktop ? direction : 'vertical';
	}
</script>

{#snippet paneTile(pane: SessionWorkspacePane, index: number)}
	<section
		class={immersive
			? 'flex h-full min-h-0 min-w-0 overflow-hidden bg-background'
			: 'flex h-full min-h-0 min-w-0 overflow-hidden rounded-md border bg-background'}
	>
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">{@render children(pane, index)}</div>
	</section>
{/snippet}

{#snippet handle(label = 'Resize session pane boundary')}
	<Resizable.Handle
		withHandle
		tabindex={0}
		aria-label={label}
		class="bg-transparent hover:bg-muted/60 focus-visible:ring-2 data-[direction=horizontal]:mx-1 data-[direction=horizontal]:w-2 data-[direction=horizontal]:after:w-2 data-[direction=vertical]:my-1 data-[direction=vertical]:h-2 data-[direction=vertical]:after:h-2"
	/>
{/snippet}

{#if tree.type === 'pane'}
	{@const entry = paneById.get(tree.paneId)}
	{#if entry}
		{@render paneTile(entry.pane, entry.index)}
	{/if}
{:else}
	<Resizable.PaneGroup
		direction={groupDirection(tree.direction)}
		keyboardResizeBy={5}
		autoSaveId={storageKey(path)}
	>
		<Resizable.Pane defaultSize={50} minSize={paneMinSize()}>
			<Self tree={tree.children[0]} {panes} path={`${path}-a`} {desktop} {immersive} {storageKey}>
				{#snippet children(pane: SessionWorkspacePane, index: number)}
					{@render children(pane, index)}
				{/snippet}
			</Self>
		</Resizable.Pane>
		{@render handle()}
		<Resizable.Pane defaultSize={50} minSize={paneMinSize()}>
			<Self tree={tree.children[1]} {panes} path={`${path}-b`} {desktop} {immersive} {storageKey}>
				{#snippet children(pane: SessionWorkspacePane, index: number)}
					{@render children(pane, index)}
				{/snippet}
			</Self>
		</Resizable.Pane>
	</Resizable.PaneGroup>
{/if}
