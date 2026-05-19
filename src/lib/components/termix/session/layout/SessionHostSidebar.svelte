<script lang="ts">
	import { Monitor, Search, Server, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { HostSummary } from '$lib/remotes/hosts.remote';
	import { protocolsForHost, type WorkspaceProtocol } from './session-workspace-protocols';

	let {
		hosts,
		selectedHostId,
		activeProtocol,
		onOpen,
		onClose
	}: {
		hosts: HostSummary[];
		selectedHostId: string | null;
		activeProtocol: WorkspaceProtocol;
		onOpen: (host: HostSummary, protocol: WorkspaceProtocol) => void;
		onClose: () => void;
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

<aside class="flex h-full min-h-0 w-72 shrink-0 flex-col border-l bg-background">
	<div class="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
		<div class="flex min-w-0 items-center gap-2">
			<Server class="size-4 shrink-0 text-muted-foreground" />
			<div class="min-w-0">
				<h2 class="truncate text-sm font-semibold">Sessions</h2>
				<p class="truncate text-xs text-muted-foreground">
					{protocolLabels[activeProtocol]} open
				</p>
			</div>
		</div>
		<Button size="icon-sm" variant="ghost" aria-label="Hide session sidebar" onclick={onClose}>
			<X class="size-4" />
		</Button>
	</div>
	<div class="shrink-0 border-b p-2">
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input class="h-8 pl-8 text-sm" placeholder="Filter sessions" bind:value={search} />
		</div>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		<div class="grid gap-1.5">
			{#each filteredHosts as host (host.id)}
				{@const currentHost = host.id === selectedHostId}
				{@const hostProtocols = protocolsForHost(host)}
				<section
					class={[
						'rounded-md border p-2 transition-colors',
						currentHost
							? 'border-primary/50 bg-primary/10'
							: 'border-border bg-background hover:bg-muted/40'
					]}
				>
					<button
						type="button"
						class="flex w-full min-w-0 items-start gap-2 text-left"
						aria-current={currentHost ? 'true' : undefined}
						onclick={() => openHost(host)}
					>
						<Monitor class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{host.name}</span>
							<span class="block truncate font-mono text-xs text-muted-foreground">
								{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
							</span>
						</span>
					</button>
					<div class="mt-2 flex flex-wrap gap-1">
						{#each hostProtocols as protocol (protocol)}
							<Button
								size="sm"
								variant={currentHost && activeProtocol === protocol ? 'secondary' : 'outline'}
								class="h-6 px-2 text-xs"
								aria-pressed={currentHost && activeProtocol === protocol}
								onclick={() => onOpen(host, protocol)}
							>
								{protocolLabels[protocol]}
							</Button>
						{/each}
						{#if currentHost}
							<Badge variant="outline" class="h-6">Open</Badge>
						{/if}
					</div>
				</section>
			{:else}
				<div class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
					No sessions match this filter.
				</div>
			{/each}
		</div>
	</div>
</aside>
