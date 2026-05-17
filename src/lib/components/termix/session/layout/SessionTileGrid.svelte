<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import type { SessionLayoutKind, SessionWorkspacePane } from './workspace-layout';

	let {
		layout,
		panes,
		children
	}: {
		layout: SessionLayoutKind;
		panes: SessionWorkspacePane[];
		children: Snippet<[SessionWorkspacePane, number]>;
	} = $props();

	let desktop = $state(browser ? window.matchMedia('(min-width: 1024px)').matches : false);

	onMount(() => {
		const media = window.matchMedia('(min-width: 1024px)');
		const sync = () => (desktop = media.matches);
		sync();
		media.addEventListener('change', sync);
		return () => media.removeEventListener('change', sync);
	});

	const paneSizes: Record<SessionLayoutKind, number[]> = {
		single: [100],
		'two-columns': [50, 50],
		'two-rows': [50, 50],
		three: [50, 50, 50],
		quad: [50, 50, 50, 50]
	};

	function storageKey(suffix: string) {
		return [
			'termixkit-session-layout',
			layout,
			desktop ? 'desktop' : 'compact',
			paneKey(),
			suffix
		].join(':');
	}

	function paneKey() {
		return panes.map((pane) => pane.id).join('-');
	}

	function defaultSize(index: number) {
		return paneSizes[layout][index] ?? 50;
	}

	function minSize() {
		return desktop ? 18 : 14;
	}
</script>

<div class="min-h-0 w-full min-w-0 flex-1 p-2">
	{#snippet paneTile(pane: SessionWorkspacePane, index: number)}
		<section class="flex h-full min-h-0 min-w-0 overflow-hidden rounded-md border bg-background">
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

	{#if layout === 'single'}
		{@const pane = panes[0]}
		{#if pane}
			{@render paneTile(pane, 0)}
		{/if}
	{:else if layout === 'two-columns'}
		<Resizable.PaneGroup
			direction={desktop ? 'horizontal' : 'vertical'}
			keyboardResizeBy={5}
			autoSaveId={storageKey('two')}
		>
			{#each panes as pane, index (pane.id)}
				<Resizable.Pane defaultSize={defaultSize(index)} minSize={minSize()}>
					{@render paneTile(pane, index)}
				</Resizable.Pane>
				{#if index < panes.length - 1}
					{@render handle()}
				{/if}
			{/each}
		</Resizable.PaneGroup>
	{:else if layout === 'two-rows'}
		<Resizable.PaneGroup direction="vertical" keyboardResizeBy={5} autoSaveId={storageKey('rows')}>
			{#each panes as pane, index (pane.id)}
				<Resizable.Pane defaultSize={defaultSize(index)} minSize={minSize()}>
					{@render paneTile(pane, index)}
				</Resizable.Pane>
				{#if index < panes.length - 1}
					{@render handle()}
				{/if}
			{/each}
		</Resizable.PaneGroup>
	{:else if layout === 'three'}
		{#if desktop}
			<Resizable.PaneGroup
				direction="horizontal"
				keyboardResizeBy={5}
				autoSaveId={storageKey('three')}
			>
				<Resizable.Pane defaultSize={50} minSize={18}>
					{@render paneTile(panes[0], 0)}
				</Resizable.Pane>
				{@render handle()}
				<Resizable.Pane defaultSize={50} minSize={18}>
					<Resizable.PaneGroup
						direction="vertical"
						keyboardResizeBy={5}
						autoSaveId={storageKey('three-stack')}
					>
						<Resizable.Pane defaultSize={50} minSize={18}>
							{@render paneTile(panes[1], 1)}
						</Resizable.Pane>
						{@render handle()}
						<Resizable.Pane defaultSize={50} minSize={18}>
							{@render paneTile(panes[2], 2)}
						</Resizable.Pane>
					</Resizable.PaneGroup>
				</Resizable.Pane>
			</Resizable.PaneGroup>
		{:else}
			<Resizable.PaneGroup
				direction="vertical"
				keyboardResizeBy={5}
				autoSaveId={storageKey('three')}
			>
				{#each panes as pane, index (pane.id)}
					<Resizable.Pane defaultSize={defaultSize(index)} minSize={minSize()}>
						{@render paneTile(pane, index)}
					</Resizable.Pane>
					{#if index < panes.length - 1}
						{@render handle()}
					{/if}
				{/each}
			</Resizable.PaneGroup>
		{/if}
	{:else if desktop}
		<Resizable.PaneGroup
			direction="horizontal"
			keyboardResizeBy={5}
			autoSaveId={storageKey('quad')}
		>
			<Resizable.Pane defaultSize={50} minSize={18}>
				<Resizable.PaneGroup
					direction="vertical"
					keyboardResizeBy={5}
					autoSaveId={storageKey('quad-left')}
				>
					<Resizable.Pane defaultSize={50} minSize={18}>
						{@render paneTile(panes[0], 0)}
					</Resizable.Pane>
					{@render handle()}
					<Resizable.Pane defaultSize={50} minSize={18}>
						{@render paneTile(panes[2], 2)}
					</Resizable.Pane>
				</Resizable.PaneGroup>
			</Resizable.Pane>
			{@render handle()}
			<Resizable.Pane defaultSize={50} minSize={18}>
				<Resizable.PaneGroup
					direction="vertical"
					keyboardResizeBy={5}
					autoSaveId={storageKey('quad-right')}
				>
					<Resizable.Pane defaultSize={50} minSize={18}>
						{@render paneTile(panes[1], 1)}
					</Resizable.Pane>
					{@render handle()}
					<Resizable.Pane defaultSize={50} minSize={18}>
						{@render paneTile(panes[3], 3)}
					</Resizable.Pane>
				</Resizable.PaneGroup>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{:else}
		<Resizable.PaneGroup direction="vertical" keyboardResizeBy={5} autoSaveId={storageKey('quad')}>
			{#each panes as pane, index (pane.id)}
				<Resizable.Pane defaultSize={defaultSize(index)} minSize={minSize()}>
					{@render paneTile(pane, index)}
				</Resizable.Pane>
				{#if index < panes.length - 1}
					{@render handle()}
				{/if}
			{/each}
		</Resizable.PaneGroup>
	{/if}
</div>
