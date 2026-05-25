<script lang="ts">
	import {
		FolderPlus,
		Monitor,
		PanelRightClose,
		PanelRightOpen,
		Search,
		Server
	} from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { listHostGroups, setHostGroupMembership } from '$lib/remotes/host-groups.remote';
	import type { HostSummary } from '$lib/remotes/hosts.remote';
	import type { HostGroupSummary } from '$lib/remotes/termix-core.shared';
	import { protocolsForHost, type WorkspaceProtocol } from './session-workspace-protocols';

	const groupsQuery = listHostGroups();

	let {
		hosts,
		selectedHostId,
		activeProtocol,
		expanded,
		onOpen,
		onToggleExpanded,
		onGroupsChanged
	}: {
		hosts: HostSummary[];
		selectedHostId: string | null;
		activeProtocol: WorkspaceProtocol;
		expanded: boolean;
		onOpen: (host: HostSummary, protocol: WorkspaceProtocol) => void;
		onToggleExpanded: () => void;
		onGroupsChanged?: () => Promise<void> | void;
	} = $props();

	let search = $state('');
	let busyGroupKey = $state<string | null>(null);
	let groups = $derived(groupsQuery.current ?? []);

	const protocolLabels: Record<WorkspaceProtocol, string> = {
		ssh: 'SSH',
		sftp: 'SFTP',
		rdp: 'RDP',
		vnc: 'VNC',
		telnet: 'Telnet',
		ftp: 'FTP',
		ftps: 'FTPS',
		'ssh-tunnel': 'Tunnel'
	};

	let filteredHosts = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return hosts;

		return hosts.filter((host) =>
			[
				host.name,
				host.hostname,
				host.username,
				host.folder,
				host.protocol,
				host.credentialName,
				...host.groups.map((group) => group.name),
				...host.tags
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle)
		);
	});

	function openHost(host: HostSummary) {
		const protocols = protocolsForHost(host);
		onOpen(host, protocols.includes(activeProtocol) ? activeProtocol : protocols[0]);
	}

	function hostHasGroup(host: HostSummary, groupId: string) {
		return host.groups.some((group) => group.id === groupId);
	}

	async function toggleGroup(host: HostSummary, group: HostGroupSummary, assigned: boolean) {
		const key = `${host.id}:${group.id}`;
		busyGroupKey = key;
		try {
			await setHostGroupMembership({ hostId: host.id, groupId: group.id, assigned }).updates(
				listHostGroups
			);
			await onGroupsChanged?.();
		} finally {
			if (busyGroupKey === key) busyGroupKey = null;
		}
	}
</script>

<aside
	class={[
		'flex h-full min-h-0 shrink-0 flex-col border-l bg-background transition-[width]',
		expanded ? 'w-72' : 'w-14'
	]}
	aria-label="Session sidebar"
>
	<div
		class={[
			'flex min-h-12 shrink-0 items-center border-b',
			expanded ? 'justify-between gap-2 px-3' : 'justify-center px-1'
		]}
	>
		{#if expanded}
			<div class="flex min-w-0 items-center gap-2">
				<Server class="size-4 shrink-0 text-muted-foreground" />
				<div class="min-w-0">
					<h2 class="truncate text-sm font-semibold">Sessions</h2>
					<p class="truncate text-xs text-muted-foreground">
						{protocolLabels[activeProtocol]} open
					</p>
				</div>
			</div>
		{/if}
		<Button
			size="icon-sm"
			variant="ghost"
			aria-label={expanded ? 'Collapse session sidebar' : 'Expand session sidebar'}
			title={expanded ? 'Collapse sessions' : 'Expand sessions'}
			onclick={onToggleExpanded}
		>
			{#if expanded}
				<PanelRightClose class="size-4" />
			{:else}
				<PanelRightOpen class="size-4" />
			{/if}
		</Button>
	</div>
	{#if expanded}
		<div class="shrink-0 border-b p-2">
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input class="h-8 pl-8 text-sm" placeholder="Filter sessions" bind:value={search} />
			</div>
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-y-auto">
		<div class={expanded ? 'grid' : 'grid justify-items-center py-1'}>
			{#each filteredHosts as host (host.id)}
				{@const currentHost = host.id === selectedHostId}
				{@const hostProtocols = protocolsForHost(host)}
				{#if expanded}
					<button
						type="button"
						class={[
							'flex w-full min-w-0 items-start gap-2 border-b px-3 py-2 text-left transition-colors',
							currentHost ? 'bg-primary/10' : 'hover:bg-muted/40'
						]}
						aria-current={currentHost ? 'true' : undefined}
						onclick={() => openHost(host)}
					>
						<Monitor
							class={[
								'mt-0.5 size-4 shrink-0',
								currentHost ? 'text-primary' : 'text-muted-foreground'
							]}
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{host.name}</span>
							<span class="block truncate font-mono text-xs text-muted-foreground">
								{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
							</span>
							{#if host.groups.length}
								<span class="mt-1 flex flex-wrap gap-1">
									{#each host.groups as group (group.id)}
										<Badge variant="secondary" class="h-5">{group.name}</Badge>
									{/each}
								</span>
							{/if}
							<span class="mt-1 flex flex-wrap gap-1">
								{#each hostProtocols as protocol (protocol)}
									<Button
										size="sm"
										variant={currentHost && activeProtocol === protocol ? 'secondary' : 'ghost'}
										class="h-6 px-2 text-xs"
										aria-pressed={currentHost && activeProtocol === protocol}
										onclick={(event) => {
											event.stopPropagation();
											onOpen(host, protocol);
										}}
									>
										{protocolLabels[protocol]}
									</Button>
								{/each}
								{#if currentHost}
									<Badge variant="outline" class="h-6">Open</Badge>
								{/if}
								{#if groups.length}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button
													size="sm"
													variant="ghost"
													class="h-6 px-2 text-xs"
													aria-label={`Manage groups for ${host.name}`}
													onclick={(event) => event.stopPropagation()}
													{...props}
												>
													<FolderPlus class="size-3" />
													Groups
												</Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content align="end" class="w-52">
											<DropdownMenu.Label>{host.name}</DropdownMenu.Label>
											<DropdownMenu.Separator />
											{#each groups as group (group.id)}
												{@const assigned = hostHasGroup(host, group.id)}
												<DropdownMenu.CheckboxItem
													checked={assigned}
													disabled={busyGroupKey === `${host.id}:${group.id}`}
													onclick={(event) => event.stopPropagation()}
													onCheckedChange={(checked) => toggleGroup(host, group, checked === true)}
												>
													{group.name}
												</DropdownMenu.CheckboxItem>
											{/each}
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								{/if}
							</span>
						</span>
					</button>
				{:else}
					<Button
						size="icon-sm"
						variant={currentHost ? 'secondary' : 'ghost'}
						class="my-0.5"
						aria-label={`Open ${host.name}`}
						title={`${host.name} (${hostProtocols.map((protocol) => protocolLabels[protocol]).join(', ')})`}
						onclick={() => openHost(host)}
					>
						<Monitor class="size-4" />
					</Button>
				{/if}
			{:else}
				{#if expanded}
					<div class="p-4 text-sm text-muted-foreground">No sessions match this filter.</div>
				{/if}
			{/each}
		</div>
	</div>
</aside>
