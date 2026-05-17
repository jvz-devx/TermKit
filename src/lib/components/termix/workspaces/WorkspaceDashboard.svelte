<script lang="ts">
	import { AlertCircle, Building2, RefreshCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		createWorkspace,
		listWorkspaceOverview,
		removeWorkspaceMember,
		renameWorkspace,
		setWorkspaceCredentialAssignment,
		setWorkspaceHostAssignment,
		setWorkspaceMember,
		type WorkspaceRole
	} from '$lib/remotes/workspaces.remote';
	import WorkspaceInventoryPanel from './WorkspaceInventoryPanel.svelte';
	import WorkspaceList from './WorkspaceList.svelte';
	import WorkspaceMembersPanel from './WorkspaceMembersPanel.svelte';

	const overviewQuery = listWorkspaceOverview();

	let selectedWorkspaceId = $state<string | null>(null);
	let createOpen = $state(false);
	let renameOpen = $state(false);
	let createName = $state('');
	let renameName = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let overview = $derived(overviewQuery.current);
	let workspaces = $derived(overview?.workspaces ?? []);
	let selectedWorkspace = $derived.by(() => {
		if (!workspaces.length) return null;
		return (
			workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null
		);
	});
	let activeWorkspaceId = $derived(selectedWorkspace?.id ?? null);

	function selectWorkspace(workspaceId: string) {
		selectedWorkspaceId = workspaceId;
		error = null;
	}

	function openCreateDialog() {
		createName = '';
		error = null;
		createOpen = true;
	}

	function openRenameDialog() {
		if (!selectedWorkspace) return;
		renameName = selectedWorkspace.name;
		error = null;
		renameOpen = true;
	}

	async function submitCreate() {
		busy = true;
		error = null;
		try {
			await createWorkspace({ name: createName }).updates(listWorkspaceOverview);
			createOpen = false;
			createName = '';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not create workspace';
		} finally {
			busy = false;
		}
	}

	async function submitRename() {
		if (!activeWorkspaceId) return;
		busy = true;
		error = null;
		try {
			await renameWorkspace({ workspaceId: activeWorkspaceId, name: renameName }).updates(
				listWorkspaceOverview
			);
			renameOpen = false;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not rename workspace';
		} finally {
			busy = false;
		}
	}

	async function addMember(memberName: string, role: WorkspaceRole) {
		if (!activeWorkspaceId) return;
		error = null;
		try {
			await setWorkspaceMember({ workspaceId: activeWorkspaceId, memberName, role }).updates(
				listWorkspaceOverview
			);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not update workspace member';
		}
	}

	async function removeMember(memberId: string) {
		if (!activeWorkspaceId) return;
		error = null;
		try {
			await removeWorkspaceMember({ workspaceId: activeWorkspaceId, memberId }).updates(
				listWorkspaceOverview
			);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not remove workspace member';
		}
	}

	async function assignHost(hostId: string, assigned: boolean) {
		if (!activeWorkspaceId) return;
		error = null;
		try {
			await setWorkspaceHostAssignment({
				workspaceId: activeWorkspaceId,
				itemId: hostId,
				assigned
			}).updates(listWorkspaceOverview);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not update host assignment';
		}
	}

	async function assignCredential(credentialId: string, assigned: boolean) {
		if (!activeWorkspaceId) return;
		error = null;
		try {
			await setWorkspaceCredentialAssignment({
				workspaceId: activeWorkspaceId,
				itemId: credentialId,
				assigned
			}).updates(listWorkspaceOverview);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not update credential assignment';
		}
	}
</script>

<section class="space-y-4 p-4">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="flex items-center gap-2 text-lg font-semibold">
				<Building2 class="size-5" />
				Workspaces
			</h1>
			<p class="text-sm text-muted-foreground">
				Organize shared access to hosts, credentials, and team membership.
			</p>
		</div>
		<Button size="sm" variant="outline" onclick={() => overviewQuery.refresh()}>
			<RefreshCcw class="size-4" />
			Refresh
		</Button>
	</div>

	{#if error}
		<div
			class="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			<AlertCircle class="mt-0.5 size-4 shrink-0" />
			<span>{error}</span>
		</div>
	{/if}

	{#if overviewQuery.loading && !overview}
		<div class="rounded-md border p-8 text-center text-sm text-muted-foreground">
			Loading workspaces...
		</div>
	{:else if overview}
		<div class="grid gap-4 xl:grid-cols-[320px_1fr]">
			<WorkspaceList
				{workspaces}
				selectedWorkspaceId={activeWorkspaceId}
				capabilities={overview.capabilities}
				onSelect={selectWorkspace}
				onCreate={openCreateDialog}
			/>
			<div class="space-y-4">
				<WorkspaceMembersPanel
					workspace={selectedWorkspace}
					capabilities={overview.capabilities}
					onRename={openRenameDialog}
					onAddMember={addMember}
					onRemoveMember={removeMember}
				/>
				<WorkspaceInventoryPanel
					workspace={selectedWorkspace}
					hosts={overview.hosts}
					credentials={overview.credentials}
					capabilities={overview.capabilities}
					onAssignHost={assignHost}
					onAssignCredential={assignCredential}
				/>
			</div>
		</div>
	{:else}
		<div class="rounded-md border p-8 text-center text-sm text-muted-foreground">
			Workspace data is unavailable.
		</div>
	{/if}
</section>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create workspace</Dialog.Title>
			<Dialog.Description>Create a named access scope for shared inventory.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submitCreate())}>
			<div class="space-y-2">
				<Label for="workspace-create-name">Name</Label>
				<Input id="workspace-create-name" bind:value={createName} required />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={renameOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename workspace</Dialog.Title>
			<Dialog.Description
				>Update the display name members see in their workspace list.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submitRename())}>
			<div class="space-y-2">
				<Label for="workspace-rename-name">Name</Label>
				<Input id="workspace-rename-name" bind:value={renameName} required />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (renameOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
