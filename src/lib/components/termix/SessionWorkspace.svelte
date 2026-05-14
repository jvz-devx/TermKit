<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import {
		Database,
		Maximize2,
		Monitor,
		Network,
		Power,
		RotateCcw,
		Server,
		Terminal
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import { getAppSettings, type BasicAppSettings } from '$lib/settings.remote';
	import {
		attachLiveSshSession,
		closeLiveSshSession,
		createLiveSshSession,
		createSessionLaunch,
		listHosts,
		listLiveSshSessions,
		renameLiveSshSession,
		type HostSummary,
		type LiveSshAttach,
		type LiveSshSessionSummary
	} from '$lib/termix.remote';
	import StatePanel from './StatePanel.svelte';
	import LiveSshTabStrip from './session/LiveSshTabStrip.svelte';
	import RdpLaunchPane from './session/RdpLaunchPane.svelte';
	import RdpPane from './session/RdpPane.svelte';
	import SftpLaunchPane from './session/SftpLaunchPane.svelte';
	import SessionHostLauncher from './session/SessionHostLauncher.svelte';
	import SshLaunchPane from './session/SshLaunchPane.svelte';
	import TerminalPane from './session/TerminalPane.svelte';
	import VncLaunchPane from './session/VncLaunchPane.svelte';

	type WorkspaceProtocol = 'ssh' | 'sftp' | 'rdp' | 'vnc' | 'telnet';
	type LauncherProtocolFilter = WorkspaceProtocol | 'all';

	const hostsQuery = listHosts();
	const settingsQuery = getAppSettings();
	const liveSshSessionsQuery = listLiveSshSessions();
	const liveSshRefreshIntervalMs = 60_000;
	const defaultSessionSettings: BasicAppSettings = {
		ticketTtlSeconds: 60,
		terminalFontSize: 13,
		clipboardSync: true,
		rememberLastActiveTab: true
	};
	const lastProtocolStoragePrefix = 'termixkit:last-protocol:';
	const tabIcons = {
		ssh: Terminal,
		sftp: Database,
		rdp: Monitor,
		vnc: Network,
		telnet: Terminal
	};

	let reconnectNonce = $state(0);
	let pausedSessionKey = $state<string | null>(null);
	let sessionSearch = $state('');
	let activeLiveSshSessionId = $state<string | null>(null);
	let liveSshAttach = $state<LiveSshAttach | null>(null);
	let liveSshBusy = $state(false);
	let liveSshError = $state<string | null>(null);
	let dismissedLiveSshSessionIds = $state<string[]>([]);
	let workspaceElement = $state<HTMLElement | null>(null);
	let hosts = $derived(hostsQuery.current ?? []);
	let liveSshSessions = $derived.by(() =>
		(liveSshSessionsQuery.current ?? []).filter(
			(session) => !dismissedLiveSshSessionIds.includes(session.id)
		)
	);
	let appSettings = $derived(settingsQuery.current ?? defaultSessionSettings);
	let requestedHostId = $derived(page.url.searchParams.get('host'));
	let selectedHost = $derived.by(() => {
		if (!requestedHostId) return null;
		return hosts.find((host) => host.id === requestedHostId) ?? null;
	});
	let selectedHostLiveSshSessions = $derived.by(() =>
		selectedHost ? liveSshSessions.filter((session) => session.hostId === selectedHost.id) : []
	);
	let availableTabs = $derived(selectedHost ? protocolsForHost(selectedHost) : []);
	let requestedProtocol = $derived.by(() => {
		const requestedTab = page.url.searchParams.get('tab') as WorkspaceProtocol | null;
		return requestedTab && isWorkspaceProtocol(requestedTab) ? requestedTab : null;
	});
	let launcherProtocol = $derived<LauncherProtocolFilter>(requestedProtocol ?? 'all');
	let hostSelectionHosts = $derived.by(() =>
		hosts.filter((host) => {
			if (launcherProtocol !== 'all' && !protocolsForHost(host).includes(launcherProtocol)) {
				return false;
			}

			const needle = sessionSearch.trim().toLowerCase();
			if (!needle) return true;

			return [host.name, host.hostname, host.username, host.folder, host.protocol, ...host.tags]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle);
		})
	);
	let hostSelectionTitle = $derived.by(() => {
		if (requestedHostId) return 'Host not found';
		if (launcherProtocol !== 'all') return `Select a ${launcherProtocol.toUpperCase()} host`;
		return 'Select a host';
	});
	let hostSelectionDetail = $derived.by(() => {
		if (requestedHostId) return 'The requested host does not exist or is no longer available.';
		if (launcherProtocol !== 'all') {
			return hostSelectionHosts.length
				? `Choose a host that supports ${launcherProtocol.toUpperCase()} before launching.`
				: `No hosts support ${launcherProtocol.toUpperCase()} yet.`;
		}
		return 'Choose a host from the inventory before launching a session.';
	});
	let activeProtocol = $derived.by(() => {
		if (requestedProtocol && availableTabs.includes(requestedProtocol)) return requestedProtocol;

		if (selectedHost) {
			const remembered = rememberedProtocol(selectedHost.id);
			if (remembered && availableTabs.includes(remembered)) return remembered;
		}

		return availableTabs[0] ?? requestedProtocol ?? 'ssh';
	});
	let activePauseKey = $derived(
		selectedHost ? sessionPauseKey(selectedHost.id, activeProtocol) : null
	);
	let sessionPaused = $derived(Boolean(activePauseKey && pausedSessionKey === activePauseKey));

	onMount(() => {
		const refreshTimer = window.setInterval(
			() => void listLiveSshSessions().refresh(),
			liveSshRefreshIntervalMs
		);
		return () => window.clearInterval(refreshTimer);
	});

	async function getSessionLaunch(hostId: string, protocol: WorkspaceProtocol) {
		return createSessionLaunch({ hostId, protocol });
	}

	async function reconnect() {
		if (!selectedHost || activeProtocol === 'sftp') return;
		pausedSessionKey = null;

		if (activeProtocol === 'ssh') {
			const attachableSessions = selectedHostLiveSshSessions.filter(canAttachLiveSshSession);
			const existingSession =
				attachableSessions.find((session) => session.id === activeLiveSshSessionId) ??
				attachableSessions[0];
			liveSshAttach = null;
			reconnectNonce += 1;

			if (existingSession) {
				await attachPersistentSshTab(existingSession);
			} else {
				await createPersistentSshTab();
			}
			return;
		}

		reconnectNonce += 1;
	}

	function disconnect() {
		if (!selectedHost || activeProtocol === 'sftp') return;
		const key = sessionPauseKey(selectedHost.id, activeProtocol);
		pausedSessionKey = key;
		if (activeProtocol === 'ssh') liveSshAttach = null;
		reconnectNonce += 1;
	}

	async function toggleFullscreen() {
		if (!browser || !workspaceElement) return;

		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
				return;
			}

			await workspaceElement.requestFullscreen();
		} catch {
			// Fullscreen can be denied by browser policy; keep the workspace usable.
		}
	}

	function setLauncherProtocol(protocol: LauncherProtocolFilter) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.delete('host');
		if (protocol === 'all') {
			params.delete('tab');
		} else {
			params.set('tab', protocol);
		}
		pausedSessionKey = null;
		liveSshAttach = null;
		activeLiveSshSessionId = null;
		void goto(resolve(sessionUrl(params) as '/'), {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	}

	function selectHost(host: HostSummary) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		const protocol = protocolForSelectedHost(host);
		params.set('host', host.id);
		params.set('tab', protocol);
		rememberProtocol(host.id, protocol);
		pausedSessionKey = null;
		liveSshAttach = null;
		activeLiveSshSessionId = null;
		void goto(resolve(`/sessions?${params.toString()}` as '/'));
	}

	function returnToLauncher() {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.delete('host');
		if (activeProtocol) params.set('tab', activeProtocol);
		pausedSessionKey = null;
		liveSshAttach = null;
		activeLiveSshSessionId = null;
		void goto(resolve(sessionUrl(params) as '/'));
	}

	function selectProtocol(protocol: WorkspaceProtocol) {
		if (!selectedHost) return;
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('host', selectedHost.id);
		params.set('tab', protocol);
		rememberProtocol(selectedHost.id, protocol);
		pausedSessionKey = null;
		if (protocol !== 'ssh') {
			liveSshAttach = null;
			activeLiveSshSessionId = null;
		}
		void goto(resolve(`/sessions?${params.toString()}` as '/'));
	}

	async function createPersistentSshTab() {
		if (!selectedHost || liveSshBusy) return;
		liveSshBusy = true;
		liveSshError = null;

		try {
			const launch = await createLiveSshSession({
				hostId: selectedHost.id,
				title: selectedHost.name,
				cols: 80,
				rows: 24
			});
			activeLiveSshSessionId = launch.session.id;
			dismissedLiveSshSessionIds = dismissedLiveSshSessionIds.filter(
				(sessionId) => sessionId !== launch.session.id
			);
			liveSshAttach = launch;
			pausedSessionKey = null;
		} catch (caught) {
			liveSshError = errorMessage(caught);
		} finally {
			liveSshBusy = false;
		}
	}

	async function attachPersistentSshTab(session: LiveSshSessionSummary) {
		if (liveSshBusy) return;
		liveSshBusy = true;
		liveSshError = null;
		activeLiveSshSessionId = session.id;

		if (selectedHost?.id !== session.hostId) {
			const params = new SvelteURLSearchParams(page.url.searchParams);
			params.set('host', session.hostId);
			params.set('tab', 'ssh');
			rememberProtocol(session.hostId, 'ssh');
			void goto(resolve(`/sessions?${params.toString()}` as '/'), {
				keepFocus: true,
				noScroll: true
			});
		}

		try {
			liveSshAttach = await attachLiveSshSession({
				sessionId: session.id,
				cols: session.terminalCols,
				rows: session.terminalRows
			});
			dismissedLiveSshSessionIds = dismissedLiveSshSessionIds.filter(
				(sessionId) => sessionId !== session.id
			);
			pausedSessionKey = null;
		} catch (caught) {
			liveSshError = errorMessage(caught);
		} finally {
			liveSshBusy = false;
		}
	}

	async function renamePersistentSshTab(session: LiveSshSessionSummary, title: string) {
		try {
			await renameLiveSshSession({ sessionId: session.id, title });
			void listLiveSshSessions().refresh();
		} catch (caught) {
			liveSshError = errorMessage(caught);
		}
	}

	async function closePersistentSshTab(session: LiveSshSessionSummary) {
		try {
			if (session.status === 'ended' || session.status === 'failed') {
				dismissedLiveSshSessionIds = [...dismissedLiveSshSessionIds, session.id];
			} else {
				await closeLiveSshSession(session.id);
				dismissedLiveSshSessionIds = [...dismissedLiveSshSessionIds, session.id];
				void listLiveSshSessions().refresh();
			}
			if (activeLiveSshSessionId === session.id) {
				activeLiveSshSessionId = null;
				liveSshAttach = null;
			}
		} catch (caught) {
			liveSshError = errorMessage(caught);
		}
	}

	function handleLiveSshLaunch(launch: LiveSshAttach) {
		activeLiveSshSessionId = launch.session.id;
		dismissedLiveSshSessionIds = dismissedLiveSshSessionIds.filter(
			(sessionId) => sessionId !== launch.session.id
		);
		liveSshAttach = launch;
		pausedSessionKey = null;
	}

	function refreshLiveSshSessionsSoon() {
		void listLiveSshSessions().refresh();
		if (browser) window.setTimeout(() => void listLiveSshSessions().refresh(), 250);
	}

	function handleLiveSshTerminalState(
		state: 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'
	) {
		if (state === 'error' || state === 'disconnected') refreshLiveSshSessionsSoon();
	}

	function protocolForSelectedHost(host: HostSummary): WorkspaceProtocol {
		const available = protocolsForHost(host);
		if (requestedProtocol && available.includes(requestedProtocol)) return requestedProtocol;

		const remembered = rememberedProtocol(host.id);
		if (remembered && available.includes(remembered)) return remembered;

		return host.protocol;
	}

	function rememberedProtocol(hostId: string): WorkspaceProtocol | null {
		if (!browser || !appSettings.rememberLastActiveTab) return null;

		const value = window.localStorage.getItem(`${lastProtocolStoragePrefix}${hostId}`);
		return value && isWorkspaceProtocol(value) ? value : null;
	}

	function rememberProtocol(hostId: string, protocol: WorkspaceProtocol) {
		if (!browser || !appSettings.rememberLastActiveTab) return;
		window.localStorage.setItem(`${lastProtocolStoragePrefix}${hostId}`, protocol);
	}

	function protocolsForHost(host: HostSummary): WorkspaceProtocol[] {
		return host.protocol === 'ssh' ? ['ssh', 'sftp'] : [host.protocol];
	}

	function isWorkspaceProtocol(value: string): value is WorkspaceProtocol {
		return ['ssh', 'sftp', 'rdp', 'vnc', 'telnet'].includes(value);
	}

	function sessionUrl(params: SvelteURLSearchParams) {
		const query = params.toString();
		return query ? `/sessions?${query}` : '/sessions';
	}

	function toWebSocketUrl(path: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}${path}`;
	}

	function sessionPauseKey(hostId: string, protocol: string) {
		return `termix-session:${hostId}:${protocol}`;
	}

	function canAttachLiveSshSession(session: LiveSshSessionSummary) {
		return (
			session.status === 'attached' ||
			session.status === 'detached' ||
			session.status === 'starting'
		);
	}

	function errorMessage(caught: unknown) {
		return caught instanceof Error ? caught.message : 'Could not create session ticket';
	}
</script>

<section bind:this={workspaceElement} class="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
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
			{#if selectedHost}
				<Button size="sm" variant="outline" class="gap-2" onclick={returnToLauncher}>
					<Server class="size-4" />
					Change host
				</Button>
			{/if}
			<Button
				size="icon"
				variant="ghost"
				aria-label="Reconnect"
				disabled={!selectedHost || activeProtocol === 'sftp'}
				onclick={reconnect}
			>
				<RotateCcw class="size-4" />
			</Button>
			<Button
				size="icon"
				variant="ghost"
				aria-label="Fullscreen"
				disabled={!browser}
				onclick={toggleFullscreen}
			>
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
		<div class="flex min-h-0 flex-1 flex-col">
			<LiveSshTabStrip
				sessions={liveSshSessions}
				activeSessionId={activeLiveSshSessionId}
				busy={liveSshBusy}
				onCreate={createPersistentSshTab}
				onAttach={attachPersistentSshTab}
				onRename={renamePersistentSshTab}
				onClose={closePersistentSshTab}
			/>
			<SessionHostLauncher
				hosts={hostSelectionHosts}
				allHostsCount={hosts.length}
				title={hostSelectionTitle}
				detail={hostSelectionDetail}
				{launcherProtocol}
				bind:search={sessionSearch}
				onProtocolChange={setLauncherProtocol}
				onSelectHost={selectHost}
				protocolForHost={protocolForSelectedHost}
				{protocolsForHost}
			/>
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

			<Tabs.Content value="ssh" class="m-0 flex min-h-0 flex-1 flex-col p-0">
				<LiveSshTabStrip
					sessions={liveSshSessions}
					activeSessionId={activeLiveSshSessionId}
					currentHostId={selectedHost.id}
					busy={liveSshBusy}
					onCreate={createPersistentSshTab}
					onAttach={attachPersistentSshTab}
					onRename={renamePersistentSshTab}
					onClose={closePersistentSshTab}
				/>
				<div class="min-h-0 flex-1 p-3">
					{#if liveSshError}
						<StatePanel state="error" title="SSH session failed" detail={liveSshError} />
					{:else if liveSshBusy}
						<StatePanel state="loading" title="Opening SSH tab" detail="Preparing attach ticket." />
					{:else if liveSshAttach}
						{#key `ssh-live:${liveSshAttach.session.id}:${liveSshAttach.liveTicket}:${reconnectNonce}`}
							<TerminalPane
								title={liveSshAttach.session.title}
								subtitle={`${liveSshAttach.session.username ?? 'user'}@${liveSshAttach.session.hostname}`}
								websocketUrl={toWebSocketUrl(liveSshAttach.liveWebsocketPath)}
								welcome={[
									`$ ssh ${liveSshAttach.session.hostname}`,
									'Attaching live SSH session...',
									''
								]}
								fontSize={appSettings.terminalFontSize}
								onConnectionStateChange={handleLiveSshTerminalState}
							/>
						{/key}
					{:else if sessionPaused && activeProtocol === 'ssh'}
						<StatePanel
							state="disconnected"
							title="SSH disconnected"
							detail="Reconnect to attach the SSH tab again."
						/>
					{:else if liveSshSessionsQuery.loading}
						<StatePanel
							state="loading"
							title="Loading SSH tabs"
							detail="Fetching live session state."
						/>
					{:else if selectedHostLiveSshSessions.length > 0}
						<StatePanel
							state="ready"
							title="SSH tabs available"
							detail="Existing live sessions are idle."
						/>
					{:else if browser && activeProtocol === 'ssh'}
						{#key `ssh:${selectedHost.id}:${reconnectNonce}`}
							<SshLaunchPane
								host={selectedHost}
								fontSize={appSettings.terminalFontSize}
								onLaunch={handleLiveSshLaunch}
								onConnectionStateChange={handleLiveSshTerminalState}
							/>
						{/key}
					{/if}
				</div>
			</Tabs.Content>

			<Tabs.Content value="sftp" class="m-0 min-h-0 flex-1 p-3">
				{#if browser && activeProtocol === 'sftp'}
					{#key `sftp:${selectedHost.id}:${reconnectNonce}`}
						<SftpLaunchPane hostId={selectedHost.id} />
					{/key}
				{/if}
			</Tabs.Content>

			<Tabs.Content value="rdp" class="m-0 min-h-0 flex-1 p-3">
				{#if sessionPaused && activeProtocol === 'rdp'}
					<RdpPane
						launch={null}
						error="Disconnected. Reconnect to create a new session."
						onReconnect={reconnect}
						clipboardSync={appSettings.clipboardSync}
					/>
				{:else if browser && activeProtocol === 'rdp'}
					{#key `rdp:${selectedHost.id}:${reconnectNonce}`}
						<RdpLaunchPane
							hostId={selectedHost.id}
							onReconnect={reconnect}
							clipboardSync={appSettings.clipboardSync}
						/>
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
						<VncLaunchPane hostId={selectedHost.id} fallbackUsername={selectedHost.username} />
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
								fontSize={appSettings.terminalFontSize}
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
