<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { SessionLayoutKind, SessionPaneKind } from './workspace-layout';
	import SessionLayoutControls from './SessionLayoutControls.svelte';

	let {
		isSinglePaneLayout,
		availableTabs,
		activeProtocol,
		workspaceLayoutLabel,
		workspacePaneKinds,
		layoutPersistenceError,
		layout,
		onSelectProtocol,
		onSelectLayout
	}: {
		isSinglePaneLayout: boolean;
		availableTabs: SessionPaneKind[];
		activeProtocol: SessionPaneKind;
		workspaceLayoutLabel: string;
		workspacePaneKinds: string;
		layoutPersistenceError: string | null;
		layout: SessionLayoutKind;
		onSelectProtocol: (protocol: SessionPaneKind) => void;
		onSelectLayout: (layout: SessionLayoutKind) => void;
	} = $props();
</script>

<div
	class="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b bg-muted/10 px-3 py-1.5"
	data-session-workbench-bar
>
	<div class="flex min-w-0 flex-wrap items-center gap-2">
		{#if isSinglePaneLayout}
			<div
				class="flex items-center rounded-md border bg-background p-0.5"
				aria-label="Host protocol"
			>
				{#each availableTabs as tab (tab)}
					<Button
						size="sm"
						variant={activeProtocol === tab ? 'secondary' : 'ghost'}
						class="h-8"
						aria-pressed={activeProtocol === tab}
						onclick={() => onSelectProtocol(tab)}
					>
						{tab.toUpperCase()}
					</Button>
				{/each}
			</div>
		{:else}
			<div
				class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
				data-session-workbench-mode="multi-pane"
			>
				<Badge variant="outline">{workspaceLayoutLabel}</Badge>
				<span class="truncate font-mono">{workspacePaneKinds}</span>
			</div>
		{/if}
		{#if layoutPersistenceError}
			<Badge variant="destructive">Layout not saved</Badge>
		{/if}
	</div>
	<SessionLayoutControls {layout} onChange={onSelectLayout} />
</div>
