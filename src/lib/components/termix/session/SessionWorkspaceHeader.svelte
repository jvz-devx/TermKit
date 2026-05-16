<script lang="ts">
	import { History, Maximize2, Minimize2, Power, RotateCcw, Server } from '@lucide/svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { HostSummary } from '$lib/termix.remote';

	let {
		selectedHost,
		workspaceStatus,
		workspaceStatusVariant,
		workspacePaneSummary,
		historyHref,
		isFullscreen,
		canUseFullscreen,
		canReconnect,
		canDisconnect,
		onReturnToLauncher,
		onReconnect,
		onToggleFullscreen,
		onDisconnect
	}: {
		selectedHost: HostSummary | null;
		workspaceStatus: string;
		workspaceStatusVariant: BadgeVariant;
		workspacePaneSummary: string;
		historyHref: string;
		isFullscreen: boolean;
		canUseFullscreen: boolean;
		canReconnect: boolean;
		canDisconnect: boolean;
		onReturnToLauncher: () => void;
		onReconnect: () => void;
		onToggleFullscreen: () => void;
		onDisconnect: () => void;
	} = $props();

	const FullscreenIcon = $derived(isFullscreen ? Minimize2 : Maximize2);
</script>

<div
	class="flex flex-col gap-2 border-b px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4"
>
	<div class="min-w-0">
		<div class="flex min-w-0 items-center gap-2">
			<h1 class="truncate text-sm font-semibold">{selectedHost?.name ?? 'Sessions'}</h1>
			<Badge variant={workspaceStatusVariant}>{workspaceStatus}</Badge>
		</div>
		<p class="truncate font-mono text-xs text-muted-foreground">
			{#if selectedHost}
				{selectedHost.username
					? `${selectedHost.username}@`
					: ''}{selectedHost.hostname}:{selectedHost.port}
				· {workspacePaneSummary}
			{:else}
				No host selected
			{/if}
		</p>
	</div>
	<div class="flex flex-wrap gap-1">
		<Button href={historyHref} size="sm" variant="outline" class="gap-2">
			<History class="size-4" />
			History
		</Button>
		{#if selectedHost}
			<Button size="sm" variant="outline" class="gap-2" onclick={onReturnToLauncher}>
				<Server class="size-4" />
				Change host
			</Button>
		{/if}
		<Button
			size="icon"
			variant="ghost"
			aria-label="Reconnect"
			disabled={!canReconnect}
			onclick={onReconnect}
			title="Reconnect session"
		>
			<RotateCcw class="size-4" />
		</Button>
		<Button
			size="icon"
			variant="ghost"
			aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
			disabled={!canUseFullscreen}
			onclick={onToggleFullscreen}
			title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
		>
			<FullscreenIcon class="size-4" />
		</Button>
		<Button
			size="icon"
			variant="ghost"
			aria-label="Close session"
			disabled={!canDisconnect}
			onclick={onDisconnect}
			title="Close current session"
		>
			<Power class="size-4" />
		</Button>
	</div>
</div>
