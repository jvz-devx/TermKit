<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
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
	import { createSessionLaunch, listHosts, type HostSummary } from '$lib/termix.remote';
	import StatePanel from './StatePanel.svelte';
	import RdpPane from './session/RdpPane.svelte';
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

	let reconnectNonce = $state(0);
	let pausedSessionKey = $state<string | null>(null);
	let hosts = $derived(hostsQuery.current ?? []);
	let requestedHostId = $derived(page.url.searchParams.get('host'));
	let selectedHost = $derived.by(() => {
		if (!requestedHostId) return null;
		return hosts.find((host) => host.id === requestedHostId) ?? null;
	});
	let availableTabs = $derived(selectedHost ? protocolsForHost(selectedHost) : []);
	let requestedProtocol = $derived.by(() => {
		const requestedTab = page.url.searchParams.get('tab') as WorkspaceProtocol | null;
		return requestedTab && isWorkspaceProtocol(requestedTab) ? requestedTab : null;
	});
	let hostSelectionProtocol = $derived(requestedProtocol ?? null);
	let hostSelectionHosts = $derived.by(() =>
		hostSelectionProtocol
			? hosts.filter((host) => protocolsForHost(host).includes(hostSelectionProtocol))
			: hosts
	);
	let hostSelectionTitle = $derived.by(() => {
		if (requestedHostId) return 'Host not found';
		if (hostSelectionProtocol) return `Select a ${hostSelectionProtocol.toUpperCase()} host`;
		return 'Select a host';
	});
	let hostSelectionDetail = $derived.by(() => {
		if (requestedHostId) return 'The requested host does not exist or is no longer available.';
		if (hostSelectionProtocol) {
			return hostSelectionHosts.length
				? `Choose a host that supports ${hostSelectionProtocol.toUpperCase()} before launching.`
				: `No hosts support ${hostSelectionProtocol.toUpperCase()} yet.`;
		}
		return 'Choose a host from the inventory before launching a session.';
	});
	let activeProtocol = $derived.by(() => {
		const candidate = requestedProtocol ?? 'ssh';
		if (availableTabs.includes(candidate)) return candidate;
		return availableTabs[0] ?? candidate;
	});
	let activePauseKey = $derived(
		selectedHost ? sessionPauseKey(selectedHost.id, activeProtocol) : null
	);
	let sessionPaused = $derived(Boolean(activePauseKey && pausedSessionKey === activePauseKey));

	async function getSessionLaunch(hostId: string, protocol: WorkspaceProtocol) {
		return createSessionLaunch({ hostId, protocol });
	}

	function reconnect() {
		if (!selectedHost || activeProtocol === 'sftp') return;
		pausedSessionKey = null;
		reconnectNonce += 1;
	}

	function disconnect() {
		if (!selectedHost || activeProtocol === 'sftp') return;
		const key = sessionPauseKey(selectedHost.id, activeProtocol);
		pausedSessionKey = key;
		reconnectNonce += 1;
	}

	function selectHost(host: HostSummary) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		const protocol =
			hostSelectionProtocol && protocolsForHost(host).includes(hostSelectionProtocol)
				? hostSelectionProtocol
				: host.protocol;
		params.set('host', host.id);
		params.set('tab', protocol);
		pausedSessionKey = null;
		void goto(resolve(`/sessions?${params.toString()}` as '/'));
	}

	function selectProtocol(protocol: WorkspaceProtocol) {
		if (!selectedHost) return;
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('host', selectedHost.id);
		params.set('tab', protocol);
		pausedSessionKey = null;
		void goto(resolve(`/sessions?${params.toString()}` as '/'));
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

	function sessionPauseKey(hostId: string, protocol: string) {
		return `termix-session:${hostId}:${protocol}`;
	}

	function errorMessage(caught: unknown) {
		return caught instanceof Error ? caught.message : 'Could not create session ticket';
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
			<Button
				size="icon"
				variant="ghost"
				aria-label="Reconnect"
				disabled={!selectedHost || activeProtocol === 'sftp'}
				onclick={reconnect}
			>
				<RotateCcw class="size-4" />
			</Button>
			<Button size="icon" variant="ghost" aria-label="Fullscreen">
				<Maximize2 class="size-4" />
			</Button>
			<Button
				size="icon"
				variant="ghost"
				aria-label="Disconnect"
				disabled={!selectedHost || activeProtocol === 'sftp'}
				onclick={disconnect}
			>
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
	{:else if !hosts.length}
		<div class="relative min-h-0 flex-1">
			<StatePanel
				state="error"
				title="No hosts available"
				detail="Create a host before launching sessions."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else if !selectedHost}
		<div class="min-h-0 flex-1 overflow-auto p-4">
			<div class="mx-auto flex max-w-3xl flex-col gap-3">
				<StatePanel
					state={hostSelectionHosts.length ? 'disconnected' : 'error'}
					title={hostSelectionTitle}
					detail={hostSelectionDetail}
				/>
				{#if hostSelectionHosts.length}
					<div class="overflow-hidden rounded-md border">
						{#each hostSelectionHosts as host (host.id)}
							<Button
								variant="ghost"
								class="h-auto w-full justify-start rounded-none border-b p-3 text-left last:border-b-0"
								onclick={() => selectHost(host)}
							>
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="truncate font-medium">{host.name}</span>
										<span class="text-xs text-muted-foreground">
											{(hostSelectionProtocol ?? host.protocol).toUpperCase()}
										</span>
									</div>
									<div class="truncate font-mono text-xs text-muted-foreground">
										{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
									</div>
								</div>
							</Button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<Tabs.Root value={activeProtocol} class="flex min-h-0 flex-1 flex-col">
			<Tabs.List class="h-10 justify-start rounded-none border-b bg-muted/20 px-2">
				{#each availableTabs as tab (tab)}
					<Tabs.Trigger value={tab} class="h-8 gap-2" onclick={() => selectProtocol(tab)}>
						{@const Icon = tabIcons[tab]}
						<Icon class="size-4" />
						{tab.toUpperCase()}
					</Tabs.Trigger>
				{/each}
			</Tabs.List>

			<Tabs.Content value="ssh" class="m-0 min-h-0 flex-1 p-3">
				{#if sessionPaused && activeProtocol === 'ssh'}
					<StatePanel
						state="disconnected"
						title="SSH disconnected"
						detail="Reconnect to create a new session."
					/>
				{:else if browser && activeProtocol === 'ssh'}
					{#key `ssh:${selectedHost.id}:${reconnectNonce}`}
						{#await getSessionLaunch(selectedHost.id, 'ssh')}
							<StatePanel state="loading" title="Opening SSH" detail="Creating a session ticket." />
						{:then currentLaunch}
							<TerminalPane
								title="SSH terminal"
								subtitle={`${selectedHost.username ?? 'user'}@${selectedHost.hostname}`}
								websocketUrl={currentLaunch.websocketPath
									? toWebSocketUrl(currentLaunch.websocketPath)
									: undefined}
								welcome={[`$ ssh ${selectedHost.hostname}`, 'Opening websocket bridge...', '']}
							/>
						{:catch caught}
							<StatePanel
								state="error"
								title="Session launch failed"
								detail={errorMessage(caught)}
							/>
						{/await}
					{/key}
				{/if}
			</Tabs.Content>

			<Tabs.Content value="sftp" class="m-0 min-h-0 flex-1 p-3">
				{#key selectedHost.id}
					<SftpBrowser hostId={selectedHost.id} initialPath="/" />
				{/key}
			</Tabs.Content>

			<Tabs.Content value="rdp" class="m-0 min-h-0 flex-1 p-3">
				{#if sessionPaused && activeProtocol === 'rdp'}
					<RdpPane
						launch={null}
						error="Disconnected. Reconnect to create a new session."
						onReconnect={reconnect}
					/>
				{:else if browser && activeProtocol === 'rdp'}
					{#key `rdp:${selectedHost.id}:${reconnectNonce}`}
						{#await getSessionLaunch(selectedHost.id, 'rdp')}
							<RdpPane launch={null} error={null} onReconnect={reconnect} />
						{:then currentLaunch}
							<RdpPane launch={currentLaunch} error={null} onReconnect={reconnect} />
						{:catch caught}
							<RdpPane launch={null} error={errorMessage(caught)} onReconnect={reconnect} />
						{/await}
					{/key}
				{/if}
			</Tabs.Content>

			<Tabs.Content value="vnc" class="m-0 min-h-0 flex-1 p-3">
				{#if sessionPaused && activeProtocol === 'vnc'}
					<StatePanel
						state="disconnected"
						title="VNC disconnected"
						detail="Reconnect to create a new session."
					/>
				{:else if browser && activeProtocol === 'vnc'}
					{#key `vnc:${selectedHost.id}:${reconnectNonce}`}
						{#await getSessionLaunch(selectedHost.id, 'vnc')}
							<StatePanel state="loading" title="Opening VNC" detail="Creating a session ticket." />
						{:then currentLaunch}
							<VncPane
								websocketUrl={currentLaunch.websocketPath
									? toWebSocketUrl(currentLaunch.websocketPath)
									: undefined}
								credentials={{
									username: currentLaunch.vncCredentials?.username ?? selectedHost.username,
									password: currentLaunch.vncCredentials?.password ?? null
								}}
								credentialStrategy={currentLaunch.vncCredentials?.source ?? 'none'}
							/>
						{:catch caught}
							<StatePanel
								state="error"
								title="Session launch failed"
								detail={errorMessage(caught)}
							/>
						{/await}
					{/key}
				{/if}
			</Tabs.Content>

			<Tabs.Content value="telnet" class="m-0 min-h-0 flex-1 p-3">
				{#if sessionPaused && activeProtocol === 'telnet'}
					<StatePanel
						state="disconnected"
						title="Telnet disconnected"
						detail="Reconnect to create a new session."
					/>
				{:else if browser && activeProtocol === 'telnet'}
					{#key `telnet:${selectedHost.id}:${reconnectNonce}`}
						{#await getSessionLaunch(selectedHost.id, 'telnet')}
							<StatePanel
								state="loading"
								title="Opening Telnet"
								detail="Creating a session ticket."
							/>
						{:then currentLaunch}
							<TerminalPane
								title="Telnet terminal"
								subtitle={`${selectedHost.hostname}:${selectedHost.port}`}
								websocketUrl={currentLaunch.websocketPath
									? toWebSocketUrl(currentLaunch.websocketPath)
									: undefined}
								welcome={[`Trying ${selectedHost.hostname}...`, 'Opening websocket bridge...', '']}
							/>
						{:catch caught}
							<StatePanel
								state="error"
								title="Session launch failed"
								detail={errorMessage(caught)}
							/>
						{/await}
					{/key}
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</section>
