<script lang="ts">
	import { Crown, Plus, Users } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import type { WorkspaceCapabilities, WorkspaceSummary } from '$lib/remotes/workspaces.remote';

	let {
		workspaces,
		selectedWorkspaceId,
		capabilities,
		onSelect,
		onCreate
	}: {
		workspaces: WorkspaceSummary[];
		selectedWorkspaceId: string | null;
		capabilities: WorkspaceCapabilities;
		onSelect: (workspaceId: string) => void;
		onCreate: () => void;
	} = $props();
</script>

<Card.Root>
	<Card.Header class="gap-3">
		<div class="flex items-start justify-between gap-3">
			<div>
				<Card.Title class="text-base">Workspaces</Card.Title>
				<Card.Description>Access scopes for teams, hosts, and credentials.</Card.Description>
			</div>
			<Button
				size="icon"
				variant="outline"
				aria-label="Create workspace"
				disabled={!capabilities.persistentWorkspaces}
				onclick={onCreate}
			>
				<Plus class="size-4" />
			</Button>
		</div>
		{#if !capabilities.persistentWorkspaces}
			<Badge variant="secondary" class="w-fit">Backend pending</Badge>
		{/if}
	</Card.Header>
	<Card.Content class="space-y-2">
		{#each workspaces as workspace (workspace.id)}
			<button
				type="button"
				class="w-full rounded-md border px-3 py-3 text-left transition-colors hover:bg-accent data-[selected=true]:border-primary data-[selected=true]:bg-primary/5"
				data-selected={workspace.id === selectedWorkspaceId}
				onclick={() => onSelect(workspace.id)}
			>
				<div class="flex items-center justify-between gap-2">
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{workspace.name}</p>
						<p class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
							<Users class="size-3" />
							{workspace.memberCount} member{workspace.memberCount === 1 ? '' : 's'}
						</p>
					</div>
					<Badge variant={workspace.role === 'owner' ? 'default' : 'outline'} class="shrink-0">
						{#if workspace.role === 'owner'}
							<Crown class="size-3" />
						{/if}
						{workspace.role}
					</Badge>
				</div>
				<div class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
					<span>{workspace.hostCount} hosts</span>
					<span>{workspace.credentialCount} credentials</span>
				</div>
			</button>
		{:else}
			<div class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
				No workspaces available.
			</div>
		{/each}
	</Card.Content>
</Card.Root>
