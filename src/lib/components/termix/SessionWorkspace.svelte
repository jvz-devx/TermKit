<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { History, Maximize2, Minimize2, Power, RotateCcw, Server } from '@lucide/svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { getAppSettings, type BasicAppSettings } from '$lib/settings.remote';
	import * as termixRemote from '$lib/termix.remote';
	import {
		attachLiveSshSession,
		closeLiveSshSession,
		createLiveSshSession,
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
	import SessionLayoutControls from './session/SessionLayoutControls.svelte';
	import SessionPaneFallback from './session/SessionPaneFallback.svelte';
	import SessionPaneHeader from './session/SessionPaneHeader.svelte';
	import SessionTileGrid from './session/SessionTileGrid.svelte';
	import FtpLaunchPane from './session/FtpLaunchPane.svelte';
	import SftpLaunchPane from './session/SftpLaunchPane.svelte';
	import SessionHostLauncher from './session/SessionHostLauncher.svelte';
	import SshHostKeyTrustPanel from './session/SshHostKeyTrustPanel.svelte';
	import SshLaunchPane from './session/SshLaunchPane.svelte';
	import SshTunnelPane from './session/SshTunnelPane.svelte';
	import TelnetLaunchPane from './session/TelnetLaunchPane.svelte';
	import TerminalPane from './session/TerminalPane.svelte';
	import VncLaunchPane from './session/VncLaunchPane.svelte';
	import { terminalFontSize } from '$lib/termix/host-metadata';
	import {
		normalizeSessionLayout,
		removeSessionPane,
		resizeSessionLayout,
		updateSessionPaneHost,
		updateSessionPaneKind,
		type SessionLayoutKind,
		type SessionPaneKind,
		type SessionWorkspaceLayoutMetadata
	} from './session/workspace-layout';

	type WorkspaceProtocol = SessionPaneKind;
	type LauncherProtocolFilter = WorkspaceProtocol | 'all';
	type SessionLayoutQuery = {
		current?: unknown;
		loading?: boolean;
		refresh?: () => Promise<unknown> | unknown;
	};
	type SessionLayoutRemotes = typeof termixRemote & {
		getSessionWorkspaceLayout?: () => SessionLayoutQuery;
		saveSessionWorkspaceLayout?: (input: {
			metadata: SessionWorkspaceLayoutMetadata;
		}) => Promise<unknown>;
	};

	const hostsQuery = listHosts();
	const settingsQuery = getAppSettings();
	const liveSshSessionsQuery = listLiveSshSessions();
	const layoutRemotes = termixRemote as SessionLayoutRemotes;
	const sessionWorkspaceLayoutQuery = layoutRemotes.getSessionWorkspaceLayout?.();
	const liveSshRefreshIntervalMs = 60_000;
	const defaultSessionSettings: BasicAppSettings = {
		ticketTtlSeconds: 60,
		terminalFontSize: 13,
		clipboardSync: true,
		rdpClipboard: {
			text: true,
			files: false,
			clientToRemote: true,
			remoteToClient: true,
			fileTransferSizeLimitMiB: 16
		},
		rdpPerformancePreset: 'balanced',
		rdpAudioRedirection: false,
		rememberLastActiveTab: true
	};
	const lastProtocolStoragePrefix = 'termixkit:last-protocol:';

	let reconnectNonce = $state(0);
	let pausedSessionKey = $state<string | null>(null);
	let sessionSearch = $state('');
	let activeLiveSshSessionId = $state<string | null>(null);
	let liveSshAttach = $state<LiveSshAttach | null>(null);
	let liveSshBusy = $state(false);
	let liveSshError = $state<string | null>(null);
	let dismissedLiveSshSessionIds = $state<string[]>([]);
	let workspaceElement = $state<HTMLElement | null>(null);
	let isFullscreen = $state(false);
	let layoutOverride = $state<SessionLayoutKind | null>(null);
	let paneKindOverrides = $state<Record<string, SessionPaneKind>>({});
	let paneHostIdOverrides = $state<Record<string, string>>({});
	let layoutPersistenceError = $state<string | null>(null);
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
	let primaryPaneKind = $derived<SessionPaneKind>(activeProtocol);
	let primaryPaneHostId = $derived(selectedHost?.id ?? null);
	let remoteWorkspaceLayout = $derived(
		normalizeSessionLayout(
			sessionWorkspaceLayoutQuery?.current,
			'single',
			primaryPaneKind,
			primaryPaneHostId
		)
	);
	let activeWorkspaceLayout = $derived.by(() => {
		const layout = layoutOverride ?? remoteWorkspaceLayout.layout;
		const resized = resizeSessionLayout(
			remoteWorkspaceLayout,
			layout,
			primaryPaneKind,
			primaryPaneHostId
		);

		return {
			...resized,
			panes: resized.panes.map((pane) => ({
				...pane,
				kind: paneKindOverrides[pane.id] ?? pane.kind,
				hostId: paneHostIdOverrides[pane.id] ?? pane.hostId ?? primaryPaneHostId
			}))
		};
	});
	let workspaceHasSshPane = $derived(
		activeWorkspaceLayout.panes.some((pane) => pane.kind === 'ssh')
	);
	let detachedSshCount = $derived(
		selectedHostLiveSshSessions.filter((session) => session.status === 'detached').length
	);
	let workspaceStatus = $derived.by(() => {
		if (!selectedHost) return 'No host';
		if (liveSshError) return 'Failure';
		if (sessionPaused) return 'Closed';
		if (activeProtocol === 'ssh' && liveSshAttach) return 'Attached';
		if (activeProtocol === 'ssh' && detachedSshCount) return `${detachedSshCount} detached`;
		return 'Ready';
	});
	let workspaceStatusVariant = $derived.by<BadgeVariant>(() => {
		if (liveSshError) return 'destructive';
		if (sessionPaused) return 'outline';
		if (activeProtocol === 'ssh' && liveSshAttach) return 'secondary';
		return 'outline';
	});
	let FullscreenIcon = $derived(isFullscreen ? Minimize2 : Maximize2);

	onMount(() => {
		const refreshTimer = window.setInterval(
			() => void listLiveSshSessions().refresh(),
			liveSshRefreshIntervalMs
		);
		document.addEventListener('fullscreenchange', syncFullscreenState);
		syncFullscreenState();

		return () => {
			window.clearInterval(refreshTimer);
			document.removeEventListener('fullscreenchange', syncFullscreenState);
		};
	});

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
				syncFullscreenState();
				return;
			}

			await workspaceElement.requestFullscreen();
			syncFullscreenState();
		} catch {
			// Fullscreen can be denied by browser policy; keep the workspace usable.
		}
	}

	function syncFullscreenState() {
		isFullscreen = Boolean(
			browser && workspaceElement && document.fullscreenElement === workspaceElement
		);
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

	async function selectLayout(layout: SessionLayoutKind) {
		const nextLayout = resizeSessionLayout(
			activeWorkspaceLayout,
			layout,
			primaryPaneKind,
			primaryPaneHostId
		);
		layoutOverride = layout;
		paneKindOverrides = Object.fromEntries(nextLayout.panes.map((pane) => [pane.id, pane.kind]));
		paneHostIdOverrides = Object.fromEntries(
			nextLayout.panes.flatMap((pane) => (pane.hostId ? [[pane.id, pane.hostId]] : []))
		);
		await persistSessionLayout(nextLayout);
	}

	async function selectPaneKind(paneId: string, kind: SessionPaneKind) {
		const nextLayout = updateSessionPaneKind(activeWorkspaceLayout, paneId, kind);
		paneKindOverrides = {
			...paneKindOverrides,
			[paneId]: kind
		};
		await persistSessionLayout(nextLayout);
	}

	async function selectPaneHost(paneId: string, hostId: string) {
		const nextLayout = updateSessionPaneHost(activeWorkspaceLayout, paneId, hostId);
		paneHostIdOverrides = {
			...paneHostIdOverrides,
			[paneId]: hostId
		};
		await persistSessionLayout(nextLayout);
	}

	async function reconnectPane(paneId: string) {
		pausedSessionKey = null;
		reconnectNonce += 1;
		const pane = activeWorkspaceLayout.panes.find((entry) => entry.id === paneId);
		if (pane?.kind === 'ssh') liveSshAttach = null;
	}

	async function closePane(paneId: string) {
		const nextLayout = removeSessionPane(
			activeWorkspaceLayout,
			paneId,
			primaryPaneKind,
			primaryPaneHostId
		);
		layoutOverride = nextLayout.layout;
		paneKindOverrides = Object.fromEntries(nextLayout.panes.map((pane) => [pane.id, pane.kind]));
		paneHostIdOverrides = Object.fromEntries(
			nextLayout.panes.flatMap((pane) => (pane.hostId ? [[pane.id, pane.hostId]] : []))
		);
		await persistSessionLayout(nextLayout);
	}

	async function persistSessionLayout(metadata: SessionWorkspaceLayoutMetadata) {
		const saveLayout = layoutRemotes.saveSessionWorkspaceLayout;
		if (!saveLayout) return;

		try {
			layoutPersistenceError = null;
			await saveLayout({ metadata });
			await sessionWorkspaceLayoutQuery?.refresh?.();
		} catch (caught) {
			layoutPersistenceError = errorMessage(caught);
		}
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
		return host.protocol === 'ssh' ? ['ssh', 'sftp', 'ssh-tunnel'] : [host.protocol];
	}

	function isWorkspaceProtocol(value: string): value is WorkspaceProtocol {
		return ['ssh', 'sftp', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps', 'ssh-tunnel'].includes(value);
	}

	function isPaneProtocolAvailable(host: HostSummary, kind: SessionPaneKind) {
		if (kind === 'sftp') return host.protocol === 'ssh';
		if (kind === 'ssh-tunnel') return host.protocol === 'ssh';
		return host.protocol === kind;
	}

	function hostForPane(pane: { hostId: string | null }) {
		return hosts.find((host) => host.id === pane.hostId) ?? selectedHost;
	}

	function liveSshSessionsForHost(hostId: string) {
		return liveSshSessions.filter((session) => session.hostId === hostId);
	}

	function isPanePaused(host: HostSummary, kind: SessionPaneKind) {
		return pausedSessionKey === sessionPauseKey(host.id, kind);
	}

	function sessionUrl(params: SvelteURLSearchParams) {
		const query = params.toString();
		return query ? `/sessions?${query}` : '/sessions';
	}

	function toWebSocketUrl(path: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${protocol}//${window.location.host}${path}`;
	}

	function sshWelcome(host: HostSummary, hostname: string) {
		return [
			`$ ssh ${hostname}`,
			host.sshJumpHost.enabled && host.sshJumpHost.hostId
				? `Using jump host ${host.sshJumpHost.hostId}`
				: 'Direct SSH target',
			'Attaching live SSH session...',
			''
		];
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

<section
	bind:this={workspaceElement}
	class="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden bg-background"
>
	<div
		class="flex flex-col gap-2 border-b px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4"
	>
		<div class="min-w-0">
			<div class="flex min-w-0 items-center gap-2">
				<h1 class="truncate text-sm font-semibold">{selectedHost?.name ?? 'Sessions'}</h1>
				<Badge variant={workspaceStatusVariant}>{workspaceStatus}</Badge>
			</div>
			<p class="truncate font-mono text-xs text-muted-foreground">
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
		<div class="flex flex-wrap gap-1">
			<Button href={resolve('/history' as '/')} size="sm" variant="outline" class="gap-2">
				<History class="size-4" />
				History
			</Button>
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
				title="Reconnect session"
			>
				<RotateCcw class="size-4" />
			</Button>
			<Button
				size="icon"
				variant="ghost"
				aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
				disabled={!browser}
				onclick={toggleFullscreen}
				title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
			>
				<FullscreenIcon class="size-4" />
			</Button>
			<Button
				size="icon"
				variant="ghost"
				aria-label="Close session"
				disabled={!selectedHost || activeProtocol === 'sftp'}
				onclick={disconnect}
				title="Close current session"
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
		<div class="flex min-h-0 flex-1 flex-col">
			<div
				class="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-muted/10 px-3 py-2"
			>
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					{#each availableTabs as tab (tab)}
						<Button
							size="sm"
							variant={activeProtocol === tab ? 'secondary' : 'ghost'}
							aria-pressed={activeProtocol === tab}
							onclick={() => selectProtocol(tab)}
						>
							{tab.toUpperCase()}
						</Button>
					{/each}
					{#if layoutPersistenceError}
						<Badge variant="destructive">Layout not saved</Badge>
					{/if}
				</div>
				<SessionLayoutControls layout={activeWorkspaceLayout.layout} onChange={selectLayout} />
			</div>

			{#if workspaceHasSshPane || liveSshSessions.length}
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
			{/if}

			<SessionTileGrid layout={activeWorkspaceLayout.layout} panes={activeWorkspaceLayout.panes}>
				{#snippet children(pane, index)}
					{@const paneHost = hostForPane(pane)}
					<SessionPaneHeader
						paneId={pane.id}
						kind={pane.kind}
						host={paneHost}
						{hosts}
						{index}
						onKindChange={selectPaneKind}
						onHostChange={selectPaneHost}
						onReconnect={reconnectPane}
						onClose={closePane}
					/>
					{#if !paneHost}
						<div class="min-h-0 flex-1 p-3">
							<StatePanel
								state="disconnected"
								title="No host selected"
								detail="Choose a host for this pane."
							/>
						</div>
					{:else if !isPaneProtocolAvailable(paneHost, pane.kind)}
						<SessionPaneFallback kind={pane.kind} host={paneHost} />
					{:else if pane.kind === 'ssh'}
						<div class="min-h-0 flex-1 p-3">
							{#if liveSshError}
								<StatePanel state="error" title="SSH session failed" detail={liveSshError} />
							{:else if liveSshBusy}
								<StatePanel
									state="loading"
									title="Opening SSH tab"
									detail="Preparing attach ticket."
								/>
							{:else if liveSshAttach && liveSshAttach.session.hostId === paneHost.id}
								<SshHostKeyTrustPanel host={paneHost} onEnrolled={reconnect} />
								{#key `ssh-live:${liveSshAttach.session.id}:${liveSshAttach.liveTicket}:${reconnectNonce}`}
									<TerminalPane
										title={liveSshAttach.session.title}
										subtitle={`${liveSshAttach.session.username ?? 'user'}@${liveSshAttach.session.hostname}`}
										websocketUrl={toWebSocketUrl(liveSshAttach.liveWebsocketPath)}
										welcome={sshWelcome(paneHost, liveSshAttach.session.hostname)}
										fontSize={terminalFontSize(
											paneHost.terminalPreferences,
											appSettings.terminalFontSize
										)}
										preferences={paneHost.terminalPreferences}
										onConnectionStateChange={handleLiveSshTerminalState}
									/>
								{/key}
							{:else if isPanePaused(paneHost, pane.kind)}
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
							{:else if liveSshSessionsForHost(paneHost.id).length > 0}
								<StatePanel
									state="ready"
									title="SSH tabs available"
									detail="Existing live sessions are idle."
								/>
							{:else if browser}
								<SshHostKeyTrustPanel host={paneHost} onEnrolled={reconnect} />
								{#key `ssh:${paneHost.id}:${pane.id}:${reconnectNonce}`}
									<SshLaunchPane
										host={paneHost}
										fontSize={terminalFontSize(
											paneHost.terminalPreferences,
											appSettings.terminalFontSize
										)}
										onLaunch={handleLiveSshLaunch}
										onConnectionStateChange={handleLiveSshTerminalState}
									/>
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'sftp'}
						<div class="min-h-0 flex-1 p-3">
							{#if paneHost.sshJumpHost.enabled && paneHost.sshJumpHost.hostId}
								<div
									class="mb-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
								>
									SFTP metadata uses jump host
									<span class="font-mono">{paneHost.sshJumpHost.hostId}</span>.
								</div>
							{/if}
							{#if browser}
								{#key `sftp:${paneHost.id}:${pane.id}:${reconnectNonce}`}
									<SftpLaunchPane hostId={paneHost.id} />
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'ftp' || pane.kind === 'ftps'}
						<div class="min-h-0 flex-1 p-3">
							{#if browser}
								{#key `ftp:${paneHost.id}:${pane.id}:${reconnectNonce}`}
									<FtpLaunchPane host={paneHost} />
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'ssh-tunnel'}
						<div class="min-h-0 flex-1 p-3">
							<SshTunnelPane host={paneHost} />
						</div>
					{:else if pane.kind === 'rdp'}
						<div class="min-h-0 flex-1 p-3">
							{#if isPanePaused(paneHost, pane.kind)}
								<RdpPane
									launch={null}
									error="Disconnected. Reconnect to create a new session."
									onReconnect={reconnect}
									clipboardSync={appSettings.clipboardSync}
									clipboardPolicy={appSettings.rdpClipboard}
									performancePreset={appSettings.rdpPerformancePreset}
									audioRedirection={appSettings.rdpAudioRedirection}
								/>
							{:else if browser}
								{#key `rdp:${paneHost.id}:${pane.id}:${reconnectNonce}`}
									<RdpLaunchPane
										hostId={paneHost.id}
										onReconnect={reconnect}
										clipboardSync={appSettings.clipboardSync}
										clipboardPolicy={appSettings.rdpClipboard}
										performancePreset={appSettings.rdpPerformancePreset}
										audioRedirection={appSettings.rdpAudioRedirection}
									/>
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'vnc'}
						<div class="min-h-0 flex-1 p-3">
							{#if isPanePaused(paneHost, pane.kind)}
								<StatePanel
									state="disconnected"
									title="VNC disconnected"
									detail="Reconnect to create a new session."
								/>
							{:else if browser}
								{#key `vnc:${paneHost.id}:${pane.id}:${reconnectNonce}`}
									<VncLaunchPane hostId={paneHost.id} fallbackUsername={paneHost.username} />
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'telnet'}
						<div class="min-h-0 flex-1 p-3">
							{#if isPanePaused(paneHost, pane.kind)}
								<StatePanel
									state="disconnected"
									title="Telnet disconnected"
									detail="Reconnect to create a new session."
								/>
							{:else if browser}
								{#key `telnet:${paneHost.id}:${pane.id}:${reconnectNonce}`}
									<TelnetLaunchPane
										hostId={paneHost.id}
										hostname={paneHost.hostname}
										port={paneHost.port}
										fontSize={appSettings.terminalFontSize}
									/>
								{/key}
							{/if}
						</div>
					{/if}
				{/snippet}
			</SessionTileGrid>
		</div>
	{/if}
</section>
