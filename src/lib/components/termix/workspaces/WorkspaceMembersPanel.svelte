<script lang="ts">
	import { Pencil, ShieldCheck, Trash2, UserPlus } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import type {
		WorkspaceCapabilities,
		WorkspaceRole,
		WorkspaceSummary
	} from '$lib/workspaces.remote';

	let {
		workspace,
		capabilities,
		onRename,
		onAddMember,
		onRemoveMember
	}: {
		workspace: WorkspaceSummary | null;
		capabilities: WorkspaceCapabilities;
		onRename: () => void;
		onAddMember: (memberName: string, role: WorkspaceRole) => Promise<void>;
		onRemoveMember: (memberId: string) => Promise<void>;
	} = $props();

	let memberName = $state('');
	let role = $state<WorkspaceRole>('member');
	let savingMember = $state(false);
	let removingMemberId = $state<string | null>(null);
	let canManageMembers = $derived(
		Boolean(
			workspace && !workspace.isPersonal && workspace.role === 'owner' && capabilities.membership
		)
	);
	let canRemoveMembers = $derived(canManageMembers && capabilities.removeMembers);

	async function submitMember() {
		if (!memberName.trim() || !canManageMembers) return;
		savingMember = true;
		try {
			await onAddMember(memberName, role);
			memberName = '';
			role = 'member';
		} finally {
			savingMember = false;
		}
	}

	async function removeMember(memberId: string) {
		if (!canRemoveMembers) return;
		removingMemberId = memberId;
		try {
			await onRemoveMember(memberId);
		} finally {
			removingMemberId = null;
		}
	}
</script>

<Card.Root>
	<Card.Header class="gap-3">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<Card.Title class="text-base">{workspace?.name ?? 'Workspace'}</Card.Title>
				<Card.Description>Owners can rename the workspace and manage members.</Card.Description>
			</div>
			<Button
				size="sm"
				variant="outline"
				disabled={!workspace ||
					workspace.isPersonal ||
					workspace.role !== 'owner' ||
					!capabilities.renameWorkspaces}
				onclick={onRename}
			>
				<Pencil class="size-4" />
				Rename
			</Button>
		</div>
		{#if !capabilities.membership}
			<Badge variant="secondary" class="w-fit">Membership backend pending</Badge>
		{:else if !capabilities.renameWorkspaces}
			<Badge variant="secondary" class="w-fit">Rename backend pending</Badge>
		{/if}
	</Card.Header>
	<Card.Content class="space-y-4">
		<form
			class="grid gap-3 md:grid-cols-[1fr_160px_auto]"
			onsubmit={(event) => (event.preventDefault(), submitMember())}
		>
			<div class="space-y-2">
				<Label for="workspace-member-name">User ID</Label>
				<Input
					id="workspace-member-name"
					placeholder="User UUID"
					bind:value={memberName}
					disabled={!canManageMembers}
				/>
			</div>
			<div class="space-y-2">
				<Label>Role</Label>
				<Select.Root type="single" bind:value={role} disabled={!canManageMembers}>
					<Select.Trigger class="w-full">{role}</Select.Trigger>
					<Select.Content>
						<Select.Item value="member">member</Select.Item>
						<Select.Item value="owner">owner</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
			<Button class="self-end" type="submit" disabled={!canManageMembers || savingMember}>
				<UserPlus class="size-4" />
				{savingMember ? 'Adding...' : 'Add'}
			</Button>
		</form>

		<div class="overflow-hidden rounded-md border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Member</Table.Head>
						<Table.Head>Role</Table.Head>
						<Table.Head class="w-16 text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each workspace?.members ?? [] as member (member.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{member.name}</div>
								{#if member.currentUser}
									<div class="text-xs text-muted-foreground">Current user</div>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<Badge variant={member.role === 'owner' ? 'default' : 'outline'}>
									{#if member.role === 'owner'}
										<ShieldCheck class="size-3" />
									{/if}
									{member.role}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								<div class="flex justify-end">
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Remove ${member.name}`}
										disabled={!canRemoveMembers ||
											member.currentUser ||
											removingMemberId === member.id}
										onclick={() => removeMember(member.id)}
									>
										<Trash2 class="size-4" />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={3} class="h-20 text-center text-muted-foreground">
								No members assigned.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</Card.Content>
</Card.Root>
