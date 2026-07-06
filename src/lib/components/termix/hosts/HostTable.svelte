<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { FolderPlus, Play, Search, Share2, SlidersHorizontal, Trash2, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Table from '$lib/components/ui/table';
	import { listCredentials } from '$lib/remotes/credentials.remote';
	import {
		createHostGroup,
		deleteHostGroup,
		listHostGroups
	} from '$lib/remotes/host-groups.remote';
	import { deleteHost, listHosts, shareHost, type HostSummary } from '$lib/remotes/hosts.remote';
	import HostDialog from './HostDialog.svelte';

	type HostProtocol = HostSummary['protocol'];
	type ProtocolFilter = HostProtocol | 'all';
	type ActiveFilter = {
		key: 'protocol' | 'credential' | 'folder' | 'group' | 'tag';
		label: string;
	};

	const hostsQuery = listHosts();
	const credentialsQuery = listCredentials();
	const groupsQuery = listHostGroups();
	const hostProtocols: HostProtocol[] = ['ssh', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps'];
	const protocolLabels: Record<HostProtocol, string> = {
		ssh: 'SSH',
		rdp: 'RDP',
		vnc: 'VNC',
		telnet: 'Telnet',
		ftp: 'FTP',
		ftps: 'FTPS'
	};

	let search = $state('');
	let protocolFilter = $state<ProtocolFilter>('all');
	let credentialFilter = $state('all');
	let folderFilter = $state('all');
	let groupFilter = $state('all');
	let tagFilter = $state('all');
	let groupDialogOpen = $state(false);
	let groupName = $state('');
	let savingGroup = $state(false);
	let launchingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let deleteTarget = $state<HostSummary | null>(null);
	let deleteDialogOpen = $state(false);
	let shareTarget = $state<HostSummary | null>(null);
	let shareDialogOpen = $state(false);
	let shareRecipients = $state('');
	let shareIncludeCredentials = $state(false);
	let sharing = $state(false);
	let hosts = $derived(hostsQuery.current ?? []);
	let credentials = $derived(credentialsQuery.current ?? []);
	let groups = $derived(groupsQuery.current ?? []);
	let credentialOptions = $derived.by(() => {
		const options: Array<[string, string]> = [];
		const setOption = (id: string, name: string) => {
			const existingIndex = options.findIndex(([optionId]) => optionId === id);
			if (existingIndex === -1) {
				options.push([id, name]);
			} else {
				options[existingIndex] = [id, name];
			}
		};

		for (const host of hosts) {
			if (host.credentialId)
				setOption(host.credentialId, host.credentialName ?? 'Unnamed credential');
		}
		for (const credential of credentials) {
			if (options.some(([id]) => id === credential.id)) setOption(credential.id, credential.name);
		}
		return options.sort((left, right) => left[1].localeCompare(right[1]));
	});
	let folderOptions = $derived(uniqueSorted(hosts.map((host) => host.folder).filter(isPresent)));
	let tagOptions = $derived(uniqueSorted(hosts.flatMap((host) => host.tags)));
	let selectedCredentialId = $derived(
		credentialFilter.startsWith('credential:id:')
			? credentialFilter.slice('credential:id:'.length)
			: null
	);
	let selectedFolder = $derived(
		folderFilter.startsWith('folder:') ? folderFilter.slice('folder:'.length) : null
	);
	let selectedGroupId = $derived(
		groupFilter.startsWith('group:id:') ? groupFilter.slice('group:id:'.length) : null
	);
	let selectedTag = $derived(tagFilter.startsWith('tag:') ? tagFilter.slice('tag:'.length) : null);
	let selectedCredentialLabel = $derived.by(() => {
		if (credentialFilter === 'credential:saved') return 'Has credential';
		if (credentialFilter === 'credential:none') return 'No credential';
		if (!selectedCredentialId) return null;
		return (
			credentialOptions.find(([id]) => id === selectedCredentialId)?.[1] ?? 'Selected credential'
		);
	});
	let activeFilters = $derived.by<ActiveFilter[]>(() => {
		const filters: ActiveFilter[] = [];
		if (protocolFilter !== 'all') {
			filters.push({ key: 'protocol', label: protocolLabels[protocolFilter] });
		}
		if (selectedCredentialLabel) {
			filters.push({ key: 'credential', label: selectedCredentialLabel });
		}
		if (selectedFolder) filters.push({ key: 'folder', label: selectedFolder });
		if (selectedGroupId) {
			filters.push({
				key: 'group',
				label: groups.find((group) => group.id === selectedGroupId)?.name ?? 'Selected group'
			});
		}
		if (selectedTag) filters.push({ key: 'tag', label: selectedTag });
		return filters;
	});
	let activeFilterCount = $derived(activeFilters.length);
	let filteredHosts = $derived.by(() => {
		const needle = search.trim().toLowerCase();

		return hosts.filter((host) => {
			if (protocolFilter !== 'all' && host.protocol !== protocolFilter) return false;
			if (credentialFilter === 'credential:saved' && !host.credentialId) return false;
			if (credentialFilter === 'credential:none' && host.credentialId) return false;
			if (selectedCredentialId && host.credentialId !== selectedCredentialId) return false;
			if (selectedFolder && host.folder !== selectedFolder) return false;
			if (selectedGroupId && !host.groups.some((group) => group.id === selectedGroupId))
				return false;
			if (selectedTag && !host.tags.includes(selectedTag)) return false;
			if (!needle) return true;

			return [
				host.name,
				host.hostname,
				host.username,
				host.folder,
				host.credentialName,
				host.protocol,
				...host.groups.map((group) => group.name),
				...host.tags
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle);
		});
	});

	function isPresent(value: string | null | undefined): value is string {
		return Boolean(value);
	}

	function uniqueSorted(values: string[]) {
		return values
			.filter((value, index, source) => source.indexOf(value) === index)
			.sort((left, right) => left.localeCompare(right));
	}

	function credentialValue(id: string) {
		return `credential:id:${id}`;
	}

	function folderValue(folder: string) {
		return `folder:${folder}`;
	}

	function groupValue(groupId: string) {
		return `group:id:${groupId}`;
	}

	function tagValue(tag: string) {
		return `tag:${tag}`;
	}

	function clearFilter(key: ActiveFilter['key']) {
		if (key === 'protocol') protocolFilter = 'all';
		if (key === 'credential') credentialFilter = 'all';
		if (key === 'folder') folderFilter = 'all';
		if (key === 'group') groupFilter = 'all';
		if (key === 'tag') tagFilter = 'all';
	}

	function clearFilters() {
		protocolFilter = 'all';
		credentialFilter = 'all';
		folderFilter = 'all';
		groupFilter = 'all';
		tagFilter = 'all';
	}

	async function submitGroup() {
		savingGroup = true;
		error = null;
		try {
			await createHostGroup({ name: groupName }).updates(listHostGroups);
			groupName = '';
			groupDialogOpen = false;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not save group';
		} finally {
			savingGroup = false;
		}
	}

	async function removeGroup(groupId: string) {
		error = null;
		try {
			await deleteHostGroup(groupId).updates(listHostGroups, listHosts);
			if (selectedGroupId === groupId) groupFilter = 'all';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not delete group';
		}
	}

	async function refreshInventory() {
		await Promise.all([hostsQuery.refresh(), groupsQuery.refresh()]);
	}

	async function launch(host: HostSummary) {
		launchingId = host.id;
		error = null;
		try {
			await goto(resolve(`/sessions?host=${encodeURIComponent(host.id)}` as '/'));
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not launch host';
		} finally {
			launchingId = null;
		}
	}

	function requestRemove(host: HostSummary) {
		deleteTarget = host;
		deleteDialogOpen = true;
	}

	function requestShare(host: HostSummary) {
		shareTarget = host;
		shareRecipients = '';
		shareIncludeCredentials = Boolean(host.credentialId);
		shareDialogOpen = true;
		error = null;
	}

	async function submitShare() {
		if (!shareTarget) return;
		sharing = true;
		error = null;
		try {
			await shareHost({
				hostId: shareTarget.id,
				recipients: shareRecipients,
				includeCredentials: shareIncludeCredentials
			});
			shareDialogOpen = false;
			shareTarget = null;
			shareRecipients = '';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not share host';
		} finally {
			sharing = false;
		}
	}

	async function removeTarget() {
		if (!deleteTarget) return;
		const host = deleteTarget;
		deletingId = host.id;
		error = null;
		try {
			await deleteHost(host.id).updates(listHosts, listCredentials);
			deleteDialogOpen = false;
			deleteTarget = null;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not delete host';
		} finally {
			deletingId = null;
		}
	}
</script>

<section class="space-y-3 p-4">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="text-lg font-semibold">Hosts</h1>
			<p class="text-sm text-muted-foreground">
				Searchable connection inventory for protocol launches.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Dialog.Root bind:open={groupDialogOpen}>
				<Button size="sm" variant="outline" onclick={() => (groupDialogOpen = true)}>
					<FolderPlus class="size-4" />
					Group
				</Button>
				<Dialog.Content class="max-w-md">
					<Dialog.Header>
						<Dialog.Title>Create group</Dialog.Title>
						<Dialog.Description>Groups organize hosts without changing access.</Dialog.Description>
					</Dialog.Header>
					<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submitGroup())}>
						<div class="space-y-2">
							<Label for="host-group-name">Name</Label>
							<Input id="host-group-name" bind:value={groupName} required />
						</div>
						<Dialog.Footer>
							<Button type="button" variant="outline" onclick={() => (groupDialogOpen = false)}
								>Cancel</Button
							>
							<Button type="submit" disabled={savingGroup}>
								{savingGroup ? 'Saving...' : 'Create group'}
							</Button>
						</Dialog.Footer>
					</form>
				</Dialog.Content>
			</Dialog.Root>
			<HostDialog {credentials} {groups} {hosts} onSaved={refreshInventory} />
		</div>
	</div>

	{#if groups.length}
		<div class="flex flex-wrap gap-1.5">
			{#each groups as group (group.id)}
				<div class="flex max-w-64 items-center rounded-full border bg-background">
					<Button
						size="xs"
						variant={selectedGroupId === group.id ? 'secondary' : 'ghost'}
						class="h-7 min-w-0 gap-1 rounded-full rounded-r-none px-2"
						onclick={() =>
							(groupFilter = selectedGroupId === group.id ? 'all' : groupValue(group.id))}
					>
						<span class="truncate">{group.name}</span>
						<Badge variant="outline" class="h-4 px-1 text-[10px]">{group.hostCount}</Badge>
					</Button>
					<Button
						size="icon"
						variant="ghost"
						class="h-7 w-7 rounded-full rounded-l-none"
						aria-label={`Delete ${group.name} group`}
						onclick={() => removeGroup(group.id)}
					>
						<X class="size-3" />
					</Button>
				</div>
			{/each}
		</div>
	{/if}

	<div class="flex gap-2">
		<div class="relative min-w-0 flex-1">
			<Search class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
			<Input class="pl-8" placeholder="Search name, address, folder, or tag" bind:value={search} />
		</div>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						variant={activeFilterCount ? 'secondary' : 'outline'}
						size="icon"
						aria-label={`Filter hosts${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}
						class="relative"
						{...props}
					>
						<SlidersHorizontal class="size-4" />
						{#if activeFilterCount}
							<span
								class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none text-primary-foreground"
							>
								{activeFilterCount}
							</span>
						{/if}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-64">
				<DropdownMenu.Label>Protocol</DropdownMenu.Label>
				<DropdownMenu.RadioGroup bind:value={protocolFilter}>
					<DropdownMenu.RadioItem value="all">All protocols</DropdownMenu.RadioItem>
					{#each hostProtocols as protocol (protocol)}
						<DropdownMenu.RadioItem value={protocol}
							>{protocolLabels[protocol]}</DropdownMenu.RadioItem
						>
					{/each}
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Separator />
				<DropdownMenu.Label>Credential</DropdownMenu.Label>
				<DropdownMenu.RadioGroup bind:value={credentialFilter}>
					<DropdownMenu.RadioItem value="all">Any credential state</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem value="credential:saved">Has credential</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem value="credential:none">No credential</DropdownMenu.RadioItem>
					{#if credentialOptions.length}
						<DropdownMenu.Separator />
						{#each credentialOptions as [id, name] (id)}
							<DropdownMenu.RadioItem value={credentialValue(id)}>{name}</DropdownMenu.RadioItem>
						{/each}
					{/if}
				</DropdownMenu.RadioGroup>
				{#if folderOptions.length}
					<DropdownMenu.Separator />
					<DropdownMenu.Label>Folder</DropdownMenu.Label>
					<DropdownMenu.RadioGroup bind:value={folderFilter}>
						<DropdownMenu.RadioItem value="all">All folders</DropdownMenu.RadioItem>
						{#each folderOptions as folder (folder)}
							<DropdownMenu.RadioItem value={folderValue(folder)}>{folder}</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				{/if}
				{#if groups.length}
					<DropdownMenu.Separator />
					<DropdownMenu.Label>Group</DropdownMenu.Label>
					<DropdownMenu.RadioGroup bind:value={groupFilter}>
						<DropdownMenu.RadioItem value="all">All groups</DropdownMenu.RadioItem>
						{#each groups as group (group.id)}
							<DropdownMenu.RadioItem value={groupValue(group.id)}
								>{group.name}</DropdownMenu.RadioItem
							>
						{/each}
					</DropdownMenu.RadioGroup>
				{/if}
				{#if tagOptions.length}
					<DropdownMenu.Separator />
					<DropdownMenu.Label>Tag</DropdownMenu.Label>
					<DropdownMenu.RadioGroup bind:value={tagFilter}>
						<DropdownMenu.RadioItem value="all">All tags</DropdownMenu.RadioItem>
						{#each tagOptions as tag (tag)}
							<DropdownMenu.RadioItem value={tagValue(tag)}>{tag}</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				{/if}
				{#if activeFilterCount}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={clearFilters}>Clear filters</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	{#if activeFilters.length}
		<div class="flex flex-wrap items-center gap-1.5">
			{#each activeFilters as filter (filter.key)}
				<Button
					variant="outline"
					size="xs"
					class="h-6 max-w-48 gap-1 rounded-full px-2"
					aria-label={`Clear ${filter.key} filter`}
					onclick={() => clearFilter(filter.key)}
				>
					<span class="truncate">{filter.label}</span>
					<X class="size-3" />
				</Button>
			{/each}
			<span class="text-xs text-muted-foreground">{filteredHosts.length} / {hosts.length}</span>
		</div>
	{/if}

	{#if error}
		<div
			class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			{error}
		</div>
	{/if}

	<div class="overflow-hidden rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Host</Table.Head>
					<Table.Head>Protocol</Table.Head>
					<Table.Head>Address</Table.Head>
					<Table.Head>Credential</Table.Head>
					<Table.Head>Updated</Table.Head>
					<Table.Head class="w-28 text-right">Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if hostsQuery.loading}
					<Table.Row>
						<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
							Loading hosts...
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each filteredHosts as host (host.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{host.name}</div>
								<div class="text-xs text-muted-foreground">
									{host.folder ?? 'No folder'}{host.tags.length ? ` · ${host.tags.join(', ')}` : ''}
								</div>
								{#if host.groups.length}
									<div class="mt-1 flex flex-wrap gap-1">
										{#each host.groups as group (group.id)}
											<Badge variant="secondary">{group.name}</Badge>
										{/each}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell><Badge variant="outline">{host.protocol.toUpperCase()}</Badge></Table.Cell
							>
							<Table.Cell class="font-mono text-xs">
								{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
							</Table.Cell>
							<Table.Cell>{host.credentialName ?? 'None'}</Table.Cell>
							<Table.Cell class="text-sm text-muted-foreground">
								{new Date(host.updatedAt).toLocaleString()}
							</Table.Cell>
							<Table.Cell>
								<div class="flex justify-end gap-1">
									<Button
										size="icon"
										variant="ghost"
										aria-label={`Launch ${host.name}`}
										disabled={launchingId === host.id}
										onclick={() => launch(host)}
									>
										<Play class="size-4" />
									</Button>
									<HostDialog {credentials} {groups} {hosts} {host} onSaved={refreshInventory} />
									<Button
										size="icon"
										variant="ghost"
										aria-label={`Share ${host.name}`}
										onclick={() => requestShare(host)}
									>
										<Share2 class="size-4" />
									</Button>
									<Button
										size="icon"
										variant="ghost"
										aria-label={`Delete ${host.name}`}
										disabled={deletingId === host.id}
										onclick={() => requestRemove(host)}
									>
										<Trash2 class="size-4" />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
								No hosts found.
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>

	<Dialog.Root bind:open={shareDialogOpen}>
		<Dialog.Content class="max-w-md">
			<Dialog.Header>
				<Dialog.Title>Share host</Dialog.Title>
				<Dialog.Description>
					The recipient gets a request and chooses whether to add a copy.
				</Dialog.Description>
			</Dialog.Header>
			<form
				class="flex flex-col gap-4"
				onsubmit={(event) => (event.preventDefault(), submitShare())}
			>
				<div class="flex flex-col gap-2">
					<Label for="host-share-recipients">Users or Microsoft emails</Label>
					<Textarea
						id="host-share-recipients"
						placeholder="jane@example.com, operator"
						bind:value={shareRecipients}
						required
					/>
				</div>
				<div class="flex items-center justify-between gap-3 rounded-md border p-3">
					<div>
						<Label for="host-share-credentials">Include credentials</Label>
						<p class="text-xs text-muted-foreground">
							{shareTarget?.credentialName ?? 'This host has no saved credential'}
						</p>
					</div>
					<Switch
						id="host-share-credentials"
						bind:checked={shareIncludeCredentials}
						disabled={!shareTarget?.credentialId}
					/>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (shareDialogOpen = false)}>
						Cancel
					</Button>
					<Button type="submit" disabled={sharing || !shareTarget}>
						{sharing ? 'Sharing...' : 'Share'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>

	<AlertDialog.Root bind:open={deleteDialogOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete host?</AlertDialog.Title>
				<AlertDialog.Description>
					{#if deleteTarget}
						This removes {deleteTarget.name} from the connection inventory. Existing sessions are not
						recovered from this action.
					{:else}
						This host will be removed from the connection inventory.
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={Boolean(deletingId)}>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					variant="destructive"
					disabled={!deleteTarget || Boolean(deletingId)}
					onclick={(event) => {
						event.preventDefault();
						void removeTarget();
					}}
				>
					{deletingId ? 'Deleting...' : 'Delete host'}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</section>
