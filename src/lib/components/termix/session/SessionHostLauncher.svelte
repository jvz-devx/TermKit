<script lang="ts">
	import { Terminal } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { HostSummary } from '$lib/termix.remote';
	import StatePanel from '../StatePanel.svelte';
	import type { SessionPaneKind } from './workspace-layout';

	type WorkspaceProtocol = SessionPaneKind;
	type LauncherProtocolFilter = WorkspaceProtocol | 'all';

	const launcherProtocolOptions: LauncherProtocolFilter[] = [
		'all',
		'ssh',
		'sftp',
		'rdp',
		'vnc',
		'telnet',
		'ftp',
		'ftps',
		'ssh-tunnel'
	];

	let {
		hosts,
		allHostsCount,
		title,
		detail,
		launcherProtocol,
		search = $bindable(''),
		onProtocolChange,
		onSelectHost,
		protocolForHost,
		protocolsForHost
	}: {
		hosts: HostSummary[];
		allHostsCount: number;
		title: string;
		detail: string;
		launcherProtocol: LauncherProtocolFilter;
		search?: string;
		onProtocolChange: (protocol: LauncherProtocolFilter) => void;
		onSelectHost: (host: HostSummary) => void;
		protocolForHost: (host: HostSummary) => WorkspaceProtocol;
		protocolsForHost: (host: HostSummary) => WorkspaceProtocol[];
	} = $props();

	function launcherProtocolLabel(protocol: LauncherProtocolFilter) {
		return protocol === 'all'
			? 'All'
			: protocol === 'ssh-tunnel'
				? 'Tunnel'
				: protocol.toUpperCase();
	}
</script>

<div class="min-h-0 flex-1 overflow-auto p-4">
	<div class="mx-auto flex max-w-3xl flex-col gap-3">
		<StatePanel state={hosts.length ? 'disconnected' : 'error'} {title} {detail} />
		<div class="flex flex-col gap-2 rounded-md border bg-background p-3">
			<div class="flex flex-col gap-2 md:flex-row">
				<div class="relative min-w-0 flex-1">
					<Terminal class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
					<Input
						class="pl-8"
						placeholder="Search hosts by name, address, folder, or tag"
						bind:value={search}
					/>
				</div>
				<div class="flex flex-wrap gap-1" aria-label="Protocol filters">
					{#each launcherProtocolOptions as protocol (protocol)}
						<Button
							size="sm"
							variant={launcherProtocol === protocol ? 'secondary' : 'outline'}
							aria-pressed={launcherProtocol === protocol}
							onclick={() => onProtocolChange(protocol)}
						>
							{launcherProtocolLabel(protocol)}
						</Button>
					{/each}
				</div>
			</div>
		</div>
		{#if hosts.length}
			<div class="overflow-hidden rounded-md border">
				{#each hosts as host (host.id)}
					<Button
						variant="ghost"
						class="h-auto w-full justify-start rounded-none border-b p-3 text-left last:border-b-0"
						onclick={() => onSelectHost(host)}
					>
						<div class="flex min-w-0 flex-1 items-center justify-between gap-3">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<span class="truncate font-medium">{host.name}</span>
									<Badge variant="outline">{protocolForHost(host).toUpperCase()}</Badge>
								</div>
								<div class="truncate font-mono text-xs text-muted-foreground">
									{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
								</div>
								{#if host.folder || host.tags.length}
									<div class="mt-1 truncate text-xs text-muted-foreground">
										{host.folder ?? 'No folder'}{host.tags.length
											? ` · ${host.tags.join(', ')}`
											: ''}
									</div>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								{#each protocolsForHost(host) as protocol (protocol)}
									<span class="text-xs text-muted-foreground">{protocol.toUpperCase()}</span>
								{/each}
							</div>
						</div>
					</Button>
				{/each}
			</div>
		{:else if allHostsCount}
			<StatePanel
				state="error"
				title="No matching hosts"
				detail="Adjust the search or protocol filter to launch a session."
			/>
		{/if}
	</div>
</div>
