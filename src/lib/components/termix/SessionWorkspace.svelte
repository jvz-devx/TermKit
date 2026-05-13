<script lang="ts">
	import { page } from '$app/state';
	import {
		Database,
		Maximize2,
		Monitor,
		Network,
		Power,
		RotateCcw,
		Terminal
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import {
		createSessionLaunch,
		listHosts,
		type HostSummary,
		type SessionLaunch
	} from '$lib/termix.remote';
	import StatePanel from './StatePanel.svelte';
	import SftpBrowser from './session/SftpBrowser.svelte';
	import TerminalPane from './session/TerminalPane.svelte';
	import VncPane from './session/VncPane.svelte';

	type WorkspaceProtocol = 'ssh' | 'sftp' | 'rdp' | 'vnc' | 'telnet';

	const hostsQuery = listHosts();
	const tabIcons = {
		ssh: Terminal,
		sftp: Database,
		rdp: Monitor,
		vnc: Network,
		telnet: Terminal
	};

	let activeProtocol = $state<WorkspaceProtocol>('ssh');
	let launch = $state<SessionLaunch | null>(null);
	let launchKey = $state('');
	let launchError = $state<string | null>(null);
	let hosts = $derived(hostsQuery.current ?? []);
	let selectedHost = $derived.by(() => {
		const requestedHostId = page.url.searchParams.get('host');
		return hosts.find((host) => host.id === requestedHostId) ?? hosts[0] ?? null;
	});
	let availableTabs = $derived(selectedHost ? protocolsForHost(selectedHost) : []);
	let websocketUrl = $derived(
		launch?.websocketPath ? toWebSocketUrl(launch.websocketPath) : undefined
	);

	$effect(() => {
		const requestedTab = page.url.searchParams.get('tab') as WorkspaceProtocol | null;
		if (requestedTab && isWorkspaceProtocol(requestedTab)) activeProtocol = requestedTab;
	});

	$effect(() => {
		if (!selectedHost || availableTabs.length === 0) return;
		if (!availableTabs.includes(activeProtocol)) activeProtocol = availableTabs[0];
	});

	$effect(() => {
		if (!selectedHost || activeProtocol === 'sftp') {
			launch = null;
			launchError = null;
			return;
		}
		if (selectedHost.protocol !== activeProtocol) return;

		const key = `${selectedHost.id}:${activeProtocol}`;
		if (launchKey === key) return;
		launchKey = key;
		launch = readStoredLaunch(selectedHost.id, activeProtocol);
		launchError = null;

		if (!launch) {
			void createLaunch(selectedHost.id, activeProtocol);
		}
	});

	async function createLaunch(hostId: string, protocol: WorkspaceProtocol) {
		try {
			const created = await createSessionLaunch({ hostId, protocol });
			launch = created;
			if (created.websocketPath) {
				sessionStorage.setItem(launchStorageKey(hostId, protocol), JSON.stringify(created));
			}
		} catch (caught) {
			launchError = caught instanceof Error ? caught.message : 'Could not create session ticket';
			launch = null;
		}
	}

	function reconnect() {
		if (!selectedHost || activeProtocol === 'sftp') return;
		sessionStorage.removeItem(launchStorageKey(selectedHost.id, activeProtocol));
		launchKey = '';
	}

	function protocolsForHost(host: HostSummary): WorkspaceProtocol[] {
		return host.protocol === 'ssh' ? ['ssh', 'sftp'] : [host.protocol];
	}

	function isWorkspaceProtocol(value: string): value is WorkspaceProtocol {
		return ['ssh', 'sftp', 'rdp', 'vnc', 'telnet'].includes(value);
	}

	function toWebSocketUrl(path: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}${path}`;
	}

	function readStoredLaunch(hostId: string, protocol: WorkspaceProtocol): SessionLaunch | null {
		const raw = sessionStorage.getItem(launchStorageKey(hostId, protocol));
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as SessionLaunch;
			if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() > Date.now()) return parsed;
		} catch {
			// Ignore malformed browser cache and create a fresh ticket.
		}
		sessionStorage.removeItem(launchStorageKey(hostId, protocol));
		return null;
	}

	function launchStorageKey(hostId: string, protocol: string) {
		return `termix-launch:${hostId}:${protocol}`;
	}
</script>

<section class="flex h-[calc(100vh-3rem)] min-h-[640px] flex-col">
	<div class="flex items-center justify-between border-b px-4 py-2">
		<div>
			<h1 class="text-sm font-semibold">{selectedHost?.name ?? 'Sessions'}</h1>
			<p class="font-mono text-xs text-muted-foreground">
				{#if selectedHost}
					{selectedHost.username
						? `${selectedHost.username}@`
						: ''}{selectedHost.hostname}:{selectedHost.port}
					· {activeProtocol.toUpperCase()} session
				{:else}
					No host selected
				{/if}
			</p>
		</div>
		<div class="flex gap-1">
			<Button size="icon" variant="ghost" aria-label="Reconnect" onclick={reconnect}>
				<RotateCcw class="size-4" />
			</Button>
			<Button size="icon" variant="ghost" aria-label="Fullscreen">
				<Maximize2 class="size-4" />
			</Button>
			<Button size="icon" variant="ghost" aria-label="Disconnect" onclick={() => (launch = null)}>
				<Power class="size-4" />
			</Button>
		</div>
	</div>

	{#if hostsQuery.loading}
		<div class="relative min-h-0 flex-1">
			<StatePanel
				state="loading"
				title="Loading hosts"
				detail="Fetching connection inventory."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else if !selectedHost}
		<div class="relative min-h-0 flex-1">
			<StatePanel
				state="error"
				title="No hosts available"
				detail="Create a host before launching sessions."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else}
		<Tabs.Root bind:value={activeProtocol} class="flex min-h-0 flex-1 flex-col">
			<Tabs.List class="h-10 justify-start rounded-none border-b bg-muted/20 px-2">
				{#each availableTabs as tab (tab)}
					<Tabs.Trigger value={tab} class="h-8 gap-2">
						{@const Icon = tabIcons[tab]}
						<Icon class="size-4" />
						{tab.toUpperCase()}
					</Tabs.Trigger>
				{/each}
			</Tabs.List>

			<Tabs.Content value="ssh" class="m-0 min-h-0 flex-1 p-3">
				<TerminalPane
					title="SSH terminal"
					subtitle={`${selectedHost.username ?? 'user'}@${selectedHost.hostname}`}
					{websocketUrl}
					welcome={[`$ ssh ${selectedHost.hostname}`, 'Opening websocket bridge...', '']}
				/>
			</Tabs.Content>

			<Tabs.Content value="sftp" class="m-0 min-h-0 flex-1 p-3">
				<SftpBrowser hostId={selectedHost.id} initialPath="/" />
			</Tabs.Content>

			<Tabs.Content value="rdp" class="m-0 min-h-0 flex-1 p-3">
				<div class="relative h-full min-h-[480px] overflow-hidden rounded-md border bg-neutral-950">
					<div class="absolute inset-0 grid place-items-center bg-neutral-900">
						<div class="h-3/4 w-3/4 rounded-sm border border-neutral-800 bg-neutral-950"></div>
					</div>
					<StatePanel
						state={launchError ? 'error' : 'loading'}
						title={launchError ? 'RDP launch failed' : 'Gateway authorization pending'}
						detail={launchError ?? 'Waiting for RDP gateway bootstrap.'}
						class="absolute right-3 bottom-3 left-3 bg-background"
					/>
				</div>
			</Tabs.Content>

			<Tabs.Content value="vnc" class="m-0 min-h-0 flex-1 p-3">
				<VncPane {websocketUrl} username={selectedHost.username ?? undefined} />
			</Tabs.Content>

			<Tabs.Content value="telnet" class="m-0 min-h-0 flex-1 p-3">
				<TerminalPane
					title="Telnet terminal"
					subtitle={`${selectedHost.hostname}:${selectedHost.port}`}
					{websocketUrl}
					welcome={[`Trying ${selectedHost.hostname}...`, 'Opening websocket bridge...', '']}
				/>
			</Tabs.Content>
		</Tabs.Root>

		{#if launchError}
			<StatePanel
				state="error"
				title="Session launch failed"
				detail={launchError}
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		{/if}
	{/if}
</section>
