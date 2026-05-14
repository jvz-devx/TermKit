<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import type { SessionLayoutKind, SessionWorkspacePane } from './workspace-layout';

	const gridClasses: Record<SessionLayoutKind, string> = {
		single: 'grid-cols-1 grid-rows-1',
		'two-columns': 'grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1',
		'two-rows': 'grid-cols-1 grid-rows-2',
		quad: 'grid-cols-1 grid-rows-4 lg:grid-cols-2 lg:grid-rows-2'
	};

	let {
		layout,
		panes,
		children
	}: {
		layout: SessionLayoutKind;
		panes: SessionWorkspacePane[];
		children: Snippet<[SessionWorkspacePane, number]>;
	} = $props();
</script>

<div class={cn('grid min-h-0 flex-1 gap-2 p-2', gridClasses[layout])}>
	{#each panes as pane, index (pane.id)}
		<section class="flex min-h-0 min-w-0 overflow-hidden rounded-md border bg-background">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{@render children(pane, index)}
			</div>
		</section>
	{/each}
</div>
