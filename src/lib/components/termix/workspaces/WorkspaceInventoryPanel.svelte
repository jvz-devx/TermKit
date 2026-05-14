<script lang="ts">
	import { KeyRound, Search, Server } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import type {
		WorkspaceCapabilities,
		WorkspaceCredentialSummary,
		WorkspaceHostSummary,
		WorkspaceSummary
	} from '$lib/workspaces.remote';

	let {
		workspace,
		hosts,
		credentials,
		capabilities,
		onAssignHost,
		onAssignCredential
	}: {
		workspace: WorkspaceSummary | null;
		hosts: WorkspaceHostSummary[];
		credentials: WorkspaceCredentialSummary[];
		capabilities: WorkspaceCapabilities;
		onAssignHost: (hostId: string, assigned: boolean) => Promise<void>;
		onAssignCredential: (credentialId: string, assigned: boolean) => Promise<void>;
	} = $props();

	let search = $state('');
	let assigningId = $state<string | null>(null);
	let canAssignInventory = $derived(
		Boolean(
			workspace &&
			!workspace.isPersonal &&
			workspace.role === 'owner' &&
			capabilities.inventoryAssignments
		)
	);
	let filteredHosts = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return hosts;
		return hosts.filter((host) =>
			[
				host.name,
				host.hostname,
				host.username,
				host.folder,
				host.credentialName,
				host.protocol,
				...host.tags
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle)
		);
	});
	let filteredCredentials = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return credentials;
		return credentials.filter((credential) =>
			[credential.name, credential.kind, credential.username]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle)
		);
	});

	function hostAssigned(host: WorkspaceHostSummary) {
		return Boolean(workspace && host.workspaceIds.includes(workspace.id));
	}

	function credentialAssigned(credential: WorkspaceCredentialSummary) {
		return Boolean(workspace && credential.workspaceIds.includes(workspace.id));
	}

	async function toggleHost(host: WorkspaceHostSummary) {
		if (!canAssignInventory) return;
		assigningId = host.id;
		try {
			await onAssignHost(host.id, !hostAssigned(host));
		} finally {
			assigningId = null;
		}
	}

	async function toggleCredential(credential: WorkspaceCredentialSummary) {
		if (!canAssignInventory) return;
		assigningId = credential.id;
		try {
			await onAssignCredential(credential.id, !credentialAssigned(credential));
		} finally {
			assigningId = null;
		}
	}
</script>

<Card.Root>
	<Card.Header class="gap-3">
		<div>
			<Card.Title class="text-base">Shared Inventory</Card.Title>
			<Card.Description
				>Control which hosts and credentials are visible in this workspace.</Card.Description
			>
		</div>
		{#if !capabilities.inventoryAssignments}
			<Badge variant="secondary" class="w-fit">Assignment backend pending</Badge>
		{/if}
	</Card.Header>
	<Card.Content class="space-y-4">
		<div class="relative">
			<Search class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
			<Input
				class="pl-8"
				placeholder="Search hosts, credentials, folders, or tags"
				bind:value={search}
			/>
		</div>

		<Tabs.Root value="hosts">
			<Tabs.List class="grid w-full grid-cols-2">
				<Tabs.Trigger value="hosts"><Server class="size-4" /> Hosts</Tabs.Trigger>
				<Tabs.Trigger value="credentials"><KeyRound class="size-4" /> Credentials</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="hosts" class="mt-3">
				<div class="overflow-hidden rounded-md border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-12">Share</Table.Head>
								<Table.Head>Name</Table.Head>
								<Table.Head>Endpoint</Table.Head>
								<Table.Head>Credential</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each filteredHosts as host (host.id)}
								<Table.Row>
									<Table.Cell>
										<Checkbox
											checked={hostAssigned(host)}
											disabled={!canAssignInventory || assigningId === host.id}
											aria-label={`Assign ${host.name} to ${workspace?.name ?? 'workspace'}`}
											onclick={() => toggleHost(host)}
										/>
									</Table.Cell>
									<Table.Cell>
										<div class="font-medium">{host.name}</div>
										<div class="text-xs text-muted-foreground">{host.protocol.toUpperCase()}</div>
									</Table.Cell>
									<Table.Cell>
										<div class="font-mono text-sm">{host.hostname}</div>
										<div class="text-xs text-muted-foreground">
											{host.username ?? 'No username'}
										</div>
									</Table.Cell>
									<Table.Cell>{host.credentialName ?? '-'}</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={4} class="h-20 text-center text-muted-foreground">
										No hosts match this search.
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Tabs.Content>
			<Tabs.Content value="credentials" class="mt-3">
				<div class="overflow-hidden rounded-md border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-12">Share</Table.Head>
								<Table.Head>Name</Table.Head>
								<Table.Head>Kind</Table.Head>
								<Table.Head>Used by</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each filteredCredentials as credential (credential.id)}
								<Table.Row>
									<Table.Cell>
										<Checkbox
											checked={credentialAssigned(credential)}
											disabled={!canAssignInventory || assigningId === credential.id}
											aria-label={`Assign ${credential.name} to ${workspace?.name ?? 'workspace'}`}
											onclick={() => toggleCredential(credential)}
										/>
									</Table.Cell>
									<Table.Cell>
										<div class="font-medium">{credential.name}</div>
										<div class="text-xs text-muted-foreground">
											{credential.username ?? 'No username'}
										</div>
									</Table.Cell>
									<Table.Cell>
										<Badge variant="outline">
											{credential.kind === 'ssh_key' ? 'SSH key' : 'Password'}
										</Badge>
									</Table.Cell>
									<Table.Cell>{credential.usedBy} hosts</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={4} class="h-20 text-center text-muted-foreground">
										No credentials match this search.
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</Card.Content>
</Card.Root>
