<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import type { SessionLayoutKind, SessionWorkspacePane } from './workspace-layout';

	const gridClasses: Record<SessionLayoutKind, string> = {
		single: 'grid-cols-1 grid-rows-[minmax(0,1fr)]',
		'two-columns':
			'grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]',
		'two-rows': 'grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)]',
		three:
			'grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]',
		quad:
			'grid-cols-1 grid-rows-[repeat(4,minmax(0,1fr))] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]'
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

<div class={cn('grid min-h-0 w-full min-w-0 flex-1 gap-2 p-2', gridClasses[layout])}>
	{#each panes as pane, index (pane.id)}
		<section class="flex min-h-0 min-w-0 overflow-hidden rounded-md border bg-background">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{@render children(pane, index)}
			</div>
		</section>
	{/each}
</div>
