<script lang="ts">
	import { Monitor, PanelRightClose, PanelRightOpen, Search, Server } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { HostSummary } from '$lib/remotes/hosts.remote';
	import { protocolsForHost, type WorkspaceProtocol } from './session-workspace-protocols';

	let {
		hosts,
		selectedHostId,
		activeProtocol,
		expanded,
		onOpen,
		onToggleExpanded
	}: {
		hosts: HostSummary[];
		selectedHostId: string | null;
		activeProtocol: WorkspaceProtocol;
		expanded: boolean;
		onOpen: (host: HostSummary, protocol: WorkspaceProtocol) => void;
		onToggleExpanded: () => void;
	} = $props();

	let search = $state('');

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
