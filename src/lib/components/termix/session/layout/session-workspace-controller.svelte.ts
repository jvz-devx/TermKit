/* eslint-disable svelte/prefer-svelte-reactivity */
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import { onMount } from 'svelte';
import { SvelteURLSearchParams } from 'svelte/reactivity';
import type { BadgeVariant } from '$lib/components/ui/badge';
import { getAppSettings, type BasicAppSettings } from '$lib/remotes/settings.remote';
import { terminalFontSize } from '$lib/termix/host-metadata';
import { listHosts, type HostSummary } from '$lib/remotes/hosts.remote';
import {
	attachLiveSshSession,
	closeLiveSshSession,
	createLiveSshSession,
	listLiveSshSessions,
	renameLiveSshSession,
	type LiveSshAttach,
	type LiveSshSessionSummary
} from '$lib/remotes/sessions.remote';
import {
	getSessionWorkspaceLayout,
	saveSessionWorkspaceLayout
} from '$lib/remotes/workspace-layout.remote';
import {
	clearSessionPause,
	isSessionPaused,
	persistSessionPause,
	readSessionPauseKeys,
	sessionPauseKey
} from './session-pause';
import {
	normalizeSessionLayout,
	removeSessionPane,
	resizeSessionLayout,
	updateSessionPaneHost,
	updateSessionPaneKind,
	type SessionLayoutKind,
	type SessionPaneKind,
	type SessionWorkspaceLayoutMetadata
} from './workspace-layout';
import {
	canAttachLiveSshSession,
	isPaneProtocolAvailable,
	isSshHostKeyLaunchBlocked,
	isWorkspaceProtocol,
	protocolsForHost,
	type WorkspaceProtocol
} from './session-workspace-protocols';
import {
	attachableLiveSshSessionsForHost as getAttachableLiveSshSessionsForHost,
	isHostKeyTrustFailure,
	liveSshActionDetail,
	liveSshActionTitle,
	liveSshErrorForHost as getLiveSshErrorForHost,
	sshWelcome,
	type LiveSshErrorState
} from './session-workspace-live-ssh';
import { sessionUrl, toWebSocketUrl } from './session-workspace-navigation';
import { estimateWorkspaceTerminalSize as estimateTerminalSize } from './session-workspace-terminal-size';
import { layoutOverridesFromMetadata } from './session-workspace-layout-overrides';
import {
	rememberedWorkspaceProtocol,
	rememberWorkspaceProtocol
} from './session-workspace-persistence';

type LauncherProtocolFilter = WorkspaceProtocol | 'all';
type SessionLayoutQuery = {
	current?: unknown;
	loading?: boolean;
	refresh?: () => Promise<unknown> | unknown;
};
type LiveSshLaunchTarget = {
	host?: HostSummary | null;
	paneId?: string | null;
};
export function createSessionWorkspaceController() {
	const hostsQuery = listHosts();
	const settingsQuery = getAppSettings();
	const liveSshSessionsQuery = listLiveSshSessions();
	const sessionWorkspaceLayoutQuery = getSessionWorkspaceLayout() as SessionLayoutQuery;
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
	const layoutLabels: Record<SessionLayoutKind, string> = {
		single: 'Single pane',
		'two-columns': 'Two columns',
		'two-rows': 'Two rows',
		three: 'Three panes',
		quad: '2x2 grid'
	};
	let reconnectNonce = $state(0);
	let pausedSessionKey = $state<string | null>(null);
	let persistedPausedSessionKeys = $state<string[]>(
		browser ? readSessionPauseKeys(window.localStorage) : []
	);
	let sessionSearch = $state('');
	let activeLiveSshSessionId = $state<string | null>(null);
	let liveSshAttachByPaneId = $state<Record<string, LiveSshAttach>>({});
	let liveSshBusyPaneId = $state<string | null>(null);
	let liveSshBusy = $state(false);
	let liveSshError = $state<LiveSshErrorState | null>(null);
	let dismissedLiveSshSessionIds = $state<string[]>([]);
	let workspaceElement = $state<HTMLElement | null>(null);
	let isFullscreen = $state(false);
	let layoutOverride = $state<SessionLayoutKind | null>(null);
	let paneKindOverrides = $state<Record<string, SessionPaneKind>>({});
	let paneHostIdOverrides = $state<Record<string, string>>({});
	let layoutPersistenceError = $state<string | null>(null);
	const hosts = $derived(hostsQuery.current ?? []);
	const liveSshSessions = $derived.by(() =>
		(liveSshSessionsQuery.current ?? []).filter(
			(session) =>
				canAttachLiveSshSession(session) && !dismissedLiveSshSessionIds.includes(session.id)
		)
	);
	const appSettings = $derived(settingsQuery.current ?? defaultSessionSettings);
	const requestedHostId = $derived(page.url.searchParams.get('host'));
	const selectedHost = $derived.by(() => {
		if (!requestedHostId) return null;
		return hosts.find((host) => host.id === requestedHostId) ?? null;
	});
	const selectedHostLiveSshSessions = $derived.by(() =>
		selectedHost ? liveSshSessions.filter((session) => session.hostId === selectedHost.id) : []
	);
	const availableTabs = $derived(selectedHost ? protocolsForHost(selectedHost) : []);
	const requestedProtocol = $derived.by(() => {
		const requestedTab = page.url.searchParams.get('tab') as WorkspaceProtocol | null;
		return requestedTab && isWorkspaceProtocol(requestedTab) ? requestedTab : null;
	});
	const launcherProtocol = $derived<LauncherProtocolFilter>(requestedProtocol ?? 'all');
	const hostSelectionHosts = $derived.by(() =>
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
	const hostSelectionTitle = $derived.by(() => {
		if (requestedHostId) return 'Host not found';
		if (launcherProtocol !== 'all') return `Select a ${launcherProtocol.toUpperCase()} host`;
		return 'Select a host';
	});
	const hostSelectionDetail = $derived.by(() => {
		if (requestedHostId) return 'The requested host does not exist or is no longer available.';
		if (launcherProtocol !== 'all') {
			return hostSelectionHosts.length
				? `Choose a host that supports ${launcherProtocol.toUpperCase()} before launching.`
				: `No hosts support ${launcherProtocol.toUpperCase()} yet.`;
		}
		return 'Choose a host from the inventory before launching a session.';
	});
	const activeProtocol = $derived.by(() => {
		if (requestedProtocol && availableTabs.includes(requestedProtocol)) return requestedProtocol;

		if (selectedHost) {
			const remembered = rememberedProtocol(selectedHost.id);
			if (remembered && availableTabs.includes(remembered)) return remembered;
		}

		return availableTabs[0] ?? requestedProtocol ?? 'ssh';
	});
	const activePauseKey = $derived(
		selectedHost ? sessionPauseKey(selectedHost.id, activeProtocol) : null
	);
	const sessionPaused = $derived(
		Boolean(
			activePauseKey &&
			(pausedSessionKey === activePauseKey || persistedPausedSessionKeys.includes(activePauseKey))
		)
	);
	const primaryPaneKind = $derived<SessionPaneKind>(activeProtocol);
	const primaryPaneHostId = $derived(selectedHost?.id ?? null);
	const remoteWorkspaceLayout = $derived(
		normalizeSessionLayout(
			sessionWorkspaceLayoutQuery?.current,
			'single',
			primaryPaneKind,
			primaryPaneHostId
		)
	);
	const activeWorkspaceLayout = $derived.by(() => {
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
	const workspaceHasSshPane = $derived(
		activeWorkspaceLayout.panes.some((pane) => pane.kind === 'ssh')
	);
	const isSinglePaneLayout = $derived(activeWorkspaceLayout.layout === 'single');
	const workspaceLayoutLabel = $derived(layoutLabels[activeWorkspaceLayout.layout]);
	const workspacePaneSummary = $derived(
		isSinglePaneLayout
			? `${activeProtocol.toUpperCase()} session`
			: `${workspaceLayoutLabel} workspace`
	);
	const workspacePaneKinds = $derived(
		[
			...new Set(
				activeWorkspaceLayout.panes.map((pane) =>
					pane.kind === 'ssh-tunnel' ? 'SSH tunnel' : pane.kind.toUpperCase()
				)
			)
		].join(' + ')
	);
	const detachedSshCount = $derived(
		selectedHostLiveSshSessions.filter((session) => session.status === 'detached').length
	);
	const workspaceStatus = $derived.by(() => {
		if (!selectedHost) return 'No host';
		if (liveSshError) return 'Failure';
		if (sessionPaused) return 'Closed';
		if (activeProtocol === 'ssh' && Object.keys(liveSshAttachByPaneId).length) return 'Attached';
		if (activeProtocol === 'ssh' && detachedSshCount) return `${detachedSshCount} detached`;
		return 'Ready';
	});
	const workspaceStatusVariant = $derived.by<BadgeVariant>(() => {
		if (liveSshError) return 'destructive';
		if (sessionPaused) return 'outline';
		if (activeProtocol === 'ssh' && Object.keys(liveSshAttachByPaneId).length) return 'secondary';
		return 'outline';
	});
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
		clearPersistedSessionPause(selectedHost.id, activeProtocol);

		if (activeProtocol === 'ssh') {
			const attachableSessions = selectedHostLiveSshSessions.filter(canAttachLiveSshSession);
			const existingSession =
				attachableSessions.find((session) => session.id === activeLiveSshSessionId) ??
				attachableSessions[0];
			clearLiveSshViewState(preferredLiveSshPaneId(selectedHost.id));
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
		markSessionPaused(selectedHost.id, activeProtocol);
		if (activeProtocol === 'ssh') {
			clearLiveSshViewState(preferredLiveSshPaneId(selectedHost.id));
		}
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
		clearLiveSshViewState();
		activeLiveSshSessionId = null;
		liveSshError = null;
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
		clearPersistedSessionPause(host.id, protocol);
		clearLiveSshViewState();
		activeLiveSshSessionId = null;
		liveSshError = null;
		void goto(resolve(`/sessions?${params.toString()}` as '/'));
	}

	function returnToLauncher() {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.delete('host');
		if (activeProtocol) params.set('tab', activeProtocol);
		pausedSessionKey = null;
		clearLiveSshViewState();
		activeLiveSshSessionId = null;
		liveSshError = null;
		void goto(resolve(sessionUrl(params) as '/'));
	}

	function selectProtocol(protocol: WorkspaceProtocol) {
		if (!selectedHost) return;
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('host', selectedHost.id);
		params.set('tab', protocol);
		rememberProtocol(selectedHost.id, protocol);
		clearPersistedSessionPause(selectedHost.id, protocol);
		liveSshError = null;
		if (protocol !== 'ssh') {
			clearLiveSshViewState();
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
		applyLayoutOverrides(nextLayout);
		await persistSessionLayout(nextLayout);
	}

	async function selectPaneKind(paneId: string, kind: SessionPaneKind) {
		const previousPane = activeWorkspaceLayout.panes.find((pane) => pane.id === paneId);
		const nextLayout = updateSessionPaneKind(activeWorkspaceLayout, paneId, kind);
		paneKindOverrides = {
			...paneKindOverrides,
			[paneId]: kind
		};
		if (previousPane?.kind === 'ssh') clearLiveSshViewState(paneId);
		if (kind === 'ssh') liveSshError = null;
		await persistSessionLayout(nextLayout);
	}

	async function selectPaneHost(paneId: string, hostId: string) {
		const previousPane = activeWorkspaceLayout.panes.find((pane) => pane.id === paneId);
		const nextLayout = updateSessionPaneHost(activeWorkspaceLayout, paneId, hostId);
		paneHostIdOverrides = {
			...paneHostIdOverrides,
			[paneId]: hostId
		};
		if (previousPane?.kind === 'ssh') clearLiveSshViewState(paneId);
		await persistSessionLayout(nextLayout);
	}

	async function reconnectPane(paneId: string) {
		reconnectNonce += 1;
		const pane = activeWorkspaceLayout.panes.find((entry) => entry.id === paneId);
		const paneHost = pane ? hostForPane(pane) : null;
		if (pane && paneHost) clearPersistedSessionPause(paneHost.id, pane.kind);
		if (pane?.kind === 'ssh') {
			clearLiveSshViewState(pane.id);
			liveSshError = null;
		}
	}

	async function closePane(paneId: string) {
		const previousPane = activeWorkspaceLayout.panes.find((pane) => pane.id === paneId);
		const nextLayout = removeSessionPane(
			activeWorkspaceLayout,
			paneId,
			primaryPaneKind,
			primaryPaneHostId
		);
		applyLayoutOverrides(nextLayout);
		if (previousPane?.kind === 'ssh') clearLiveSshViewState(paneId);
		await persistSessionLayout(nextLayout);
	}

	async function persistSessionLayout(metadata: SessionWorkspaceLayoutMetadata) {
		try {
			layoutPersistenceError = null;
			await saveSessionWorkspaceLayout({ metadata });
			await sessionWorkspaceLayoutQuery?.refresh?.();
		} catch (caught) {
			layoutPersistenceError = errorMessage(caught);
		}
	}

	async function createPersistentSshTab(target: LiveSshLaunchTarget = {}) {
		const host = target.host ?? selectedHost;
		if (!host || liveSshBusy) return;
		liveSshBusy = true;
		liveSshError = null;
		const targetPaneId = target.paneId ?? preferredLiveSshPaneId(host.id);
		liveSshBusyPaneId = targetPaneId;

		try {
			const size = estimateWorkspaceTerminalSize(host);
			const launch = await createLiveSshSession({
				hostId: host.id,
				title: host.name,
				cols: size.cols,
				rows: size.rows
			});
			activeLiveSshSessionId = launch.session.id;
			clearPersistedSessionPause(host.id, 'ssh');
			dismissedLiveSshSessionIds = dismissedLiveSshSessionIds.filter(
				(sessionId) => sessionId !== launch.session.id
			);
			setLiveSshAttachForPane(targetPaneId, launch);
			pausedSessionKey = null;
		} catch (caught) {
			liveSshError = {
				action: 'create',
				message: errorMessage(caught),
				hostId: host.id,
				sessionId: null
			};
		} finally {
			liveSshBusy = false;
			liveSshBusyPaneId = null;
		}
	}

	async function attachPersistentSshTab(
		session: LiveSshSessionSummary,
		targetPaneId: string | null = null
	) {
		if (liveSshBusy) return;
		liveSshBusy = true;
		liveSshError = null;
		activeLiveSshSessionId = session.id;
		let resolvedPaneId = targetPaneId ?? preferredLiveSshPaneId(session.hostId);
		liveSshBusyPaneId = resolvedPaneId;

		if (selectedHost?.id !== session.hostId) {
			const params = new SvelteURLSearchParams(page.url.searchParams);
			params.set('host', session.hostId);
			params.set('tab', 'ssh');
			rememberProtocol(session.hostId, 'ssh');
			await goto(resolve(`/sessions?${params.toString()}` as '/'), {
				keepFocus: true,
				noScroll: true
			});
			resolvedPaneId = targetPaneId ?? preferredLiveSshPaneId(session.hostId);
			liveSshBusyPaneId = resolvedPaneId;
		}

		try {
			const host = hosts.find((entry) => entry.id === session.hostId) ?? selectedHost;
			const size = host
				? estimateWorkspaceTerminalSize(host)
				: { cols: session.terminalCols, rows: session.terminalRows };
			const attach = await attachLiveSshSession({
				sessionId: session.id,
				cols: size.cols,
				rows: size.rows
			});
			setLiveSshAttachForPane(resolvedPaneId, attach);
			clearPersistedSessionPause(session.hostId, 'ssh');
			dismissedLiveSshSessionIds = dismissedLiveSshSessionIds.filter(
				(sessionId) => sessionId !== session.id
			);
			pausedSessionKey = null;
		} catch (caught) {
			liveSshError = {
				action: 'attach',
				message: errorMessage(caught),
				hostId: session.hostId,
				sessionId: session.id
			};
		} finally {
			liveSshBusy = false;
			liveSshBusyPaneId = null;
		}
	}

	async function renamePersistentSshTab(session: LiveSshSessionSummary, title: string) {
		try {
			await renameLiveSshSession({ sessionId: session.id, title });
			void listLiveSshSessions().refresh();
		} catch (caught) {
			liveSshError = {
				action: 'rename',
				message: errorMessage(caught),
				hostId: session.hostId,
				sessionId: session.id
			};
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
			}
			clearLiveSshAttachBySession(session.id);
			markSessionPaused(session.hostId, 'ssh');
		} catch (caught) {
			liveSshError = {
				action: 'close',
				message: errorMessage(caught),
				hostId: session.hostId,
				sessionId: session.id
			};
		}
	}

	function handleLiveSshLaunch(launch: LiveSshAttach, paneId: string | null = null) {
		activeLiveSshSessionId = launch.session.id;
		clearPersistedSessionPause(launch.session.hostId, 'ssh');
		dismissedLiveSshSessionIds = dismissedLiveSshSessionIds.filter(
			(sessionId) => sessionId !== launch.session.id
		);
		setLiveSshAttachForPane(paneId ?? preferredLiveSshPaneId(launch.session.hostId), launch);
		pausedSessionKey = null;
	}

	function refreshLiveSshSessionsSoon() {
		void listLiveSshSessions().refresh();
		if (browser) window.setTimeout(() => void listLiveSshSessions().refresh(), 250);
	}

	function handleLiveSshTerminalState(
		state: 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected',
		paneId: string | null = null
	) {
		if (state === 'error' || state === 'disconnected') {
			if (paneId) clearLiveSshViewState(paneId);
			refreshLiveSshSessionsSoon();
		}
	}

	function setLiveSshAttachForPane(paneId: string | null, launch: LiveSshAttach) {
		if (!paneId) return;
		liveSshAttachByPaneId = {
			...liveSshAttachByPaneId,
			[paneId]: launch
		};
		activeLiveSshSessionId = launch.session.id;
	}

	function clearLiveSshAttachBySession(sessionId: string) {
		liveSshAttachByPaneId = Object.fromEntries(
			Object.entries(liveSshAttachByPaneId).filter(([, attach]) => attach.session.id !== sessionId)
		);
	}

	function clearLiveSshViewState(paneId: string | null = null) {
		liveSshError = null;
		if (!paneId) {
			liveSshAttachByPaneId = {};
			activeLiveSshSessionId = null;
			return;
		}
		const attach = liveSshAttachByPaneId[paneId];
		liveSshAttachByPaneId = Object.fromEntries(
			Object.entries(liveSshAttachByPaneId).filter(([entryPaneId]) => entryPaneId !== paneId)
		);
		if (attach?.session.id === activeLiveSshSessionId) activeLiveSshSessionId = null;
	}

	function applyLayoutOverrides(metadata: SessionWorkspaceLayoutMetadata) {
		const overrides = layoutOverridesFromMetadata(metadata);
		layoutOverride = overrides.layoutOverride;
		paneKindOverrides = overrides.paneKindOverrides;
		paneHostIdOverrides = overrides.paneHostIdOverrides;
	}

	function protocolForSelectedHost(host: HostSummary): WorkspaceProtocol {
		const available = protocolsForHost(host);
		if (requestedProtocol && available.includes(requestedProtocol)) return requestedProtocol;

		const remembered = rememberedProtocol(host.id);
		if (remembered && available.includes(remembered)) return remembered;

		return host.protocol;
	}

	function rememberedProtocol(hostId: string): WorkspaceProtocol | null {
		return rememberedWorkspaceProtocol({
			storage: browser ? window.localStorage : null,
			hostId,
			enabled: appSettings.rememberLastActiveTab
		});
	}

	function rememberProtocol(hostId: string, protocol: WorkspaceProtocol) {
		rememberWorkspaceProtocol({
			storage: browser ? window.localStorage : null,
			hostId,
			protocol,
			enabled: appSettings.rememberLastActiveTab
		});
	}

	function hostForPane(pane: { hostId: string | null }) {
		return hosts.find((host) => host.id === pane.hostId) ?? selectedHost;
	}

	function preferredLiveSshPaneId(hostId: string) {
		const matchingPane = activeWorkspaceLayout.panes.find((pane) => {
			if (pane.kind !== 'ssh') return false;
			if (liveSshAttachByPaneId[pane.id]) return false;
			return hostForPane(pane)?.id === hostId;
		});
		if (matchingPane) return matchingPane.id;

		return (
			activeWorkspaceLayout.panes.find(
				(pane) => pane.kind === 'ssh' && !liveSshAttachByPaneId[pane.id]
			)?.id ??
			activeWorkspaceLayout.panes.find((pane) => pane.kind === 'ssh')?.id ??
			null
		);
	}

	function attachableLiveSshSessionsForHost(hostId: string) {
		return getAttachableLiveSshSessionsForHost({
			sessions: liveSshSessions,
			attachments: liveSshAttachByPaneId,
			hostId
		});
	}

	function liveSshErrorForHost(hostId: string) {
		return getLiveSshErrorForHost(liveSshError, hostId);
	}

	function markSessionPaused(hostId: string, protocol: string) {
		const key = sessionPauseKey(hostId, protocol);
		pausedSessionKey = key;
		if (browser) {
			persistedPausedSessionKeys = persistSessionPause(window.localStorage, hostId, protocol);
			return;
		}
		persistedPausedSessionKeys = [...new Set([...persistedPausedSessionKeys, key])];
	}

	function clearPersistedSessionPause(hostId: string, protocol: string) {
		const key = sessionPauseKey(hostId, protocol);
		if (pausedSessionKey === key) pausedSessionKey = null;
		if (browser) {
			persistedPausedSessionKeys = clearSessionPause(window.localStorage, hostId, protocol);
			return;
		}
		persistedPausedSessionKeys = persistedPausedSessionKeys.filter((entry) => entry !== key);
	}

	function isPanePaused(host: HostSummary, kind: SessionPaneKind) {
		return (
			pausedSessionKey === sessionPauseKey(host.id, kind) ||
			isSessionPaused(persistedPausedSessionKeys, host.id, kind)
		);
	}

	function errorMessage(caught: unknown) {
		return caught instanceof Error ? caught.message : 'Could not create session ticket';
	}

	function estimateWorkspaceTerminalSize(host: HostSummary) {
		const bounds = workspaceElement?.getBoundingClientRect();
		return estimateTerminalSize({
			bounds: browser ? bounds : null,
			innerWidth: browser ? window.innerWidth : 0,
			layout: activeWorkspaceLayout.layout,
			host,
			defaultFontSize: appSettings.terminalFontSize
		});
	}

	return {
		get workspaceElement() {
			return workspaceElement;
		},
		set workspaceElement(value) {
			workspaceElement = value;
		},
		get selectedHost() {
			return selectedHost;
		},
		get workspaceStatus() {
			return workspaceStatus;
		},
		get workspaceStatusVariant() {
			return workspaceStatusVariant;
		},
		get workspacePaneSummary() {
			return workspacePaneSummary;
		},
		get isFullscreen() {
			return isFullscreen;
		},
		get activeProtocol() {
			return activeProtocol;
		},
		get returnToLauncher() {
			return returnToLauncher;
		},
		get reconnect() {
			return reconnect;
		},
		get toggleFullscreen() {
			return toggleFullscreen;
		},
		get disconnect() {
			return disconnect;
		},
		get hostsQuery() {
			return hostsQuery;
		},
		get hostSelectionHosts() {
			return hostSelectionHosts;
		},
		get hosts() {
			return hosts;
		},
		get hostSelectionTitle() {
			return hostSelectionTitle;
		},
		get hostSelectionDetail() {
			return hostSelectionDetail;
		},
		get launcherProtocol() {
			return launcherProtocol;
		},
		get sessionSearch() {
			return sessionSearch;
		},
		set sessionSearch(value) {
			sessionSearch = value;
		},
		get setLauncherProtocol() {
			return setLauncherProtocol;
		},
		get liveSshSessions() {
			return liveSshSessions;
		},
		get activeLiveSshSessionId() {
			return activeLiveSshSessionId;
		},
		get liveSshBusy() {
			return liveSshBusy;
		},
		get createPersistentSshTab() {
			return createPersistentSshTab;
		},
		get attachPersistentSshTab() {
			return attachPersistentSshTab;
		},
		get renamePersistentSshTab() {
			return renamePersistentSshTab;
		},
		get closePersistentSshTab() {
			return closePersistentSshTab;
		},
		get appSettings() {
			return appSettings;
		},
		get activeWorkspaceLayout() {
			return activeWorkspaceLayout;
		},
		get selectLayout() {
			return selectLayout;
		},
		get workspaceHasSshPane() {
			return workspaceHasSshPane;
		},
		get hostForPane() {
			return hostForPane;
		},
		get liveSshBusyPaneId() {
			return liveSshBusyPaneId;
		},
		get reconnectNonce() {
			return reconnectNonce;
		},
		get toWebSocketUrl() {
			return toWebSocketUrl;
		},
		get sshWelcome() {
			return sshWelcome;
		},
		get terminalFontSize() {
			return terminalFontSize;
		},
		get handleLiveSshTerminalState() {
			return handleLiveSshTerminalState;
		},
		get isPanePaused() {
			return isPanePaused;
		},
		get closePane() {
			return closePane;
		},
		get reconnectPane() {
			return reconnectPane;
		},
		get isPaneProtocolAvailable() {
			return isPaneProtocolAvailable;
		},
		get isSshHostKeyLaunchBlocked() {
			return isSshHostKeyLaunchBlocked;
		},
		get isHostKeyTrustFailure() {
			return isHostKeyTrustFailure;
		},
		get isSinglePaneLayout() {
			return isSinglePaneLayout;
		},
		get availableTabs() {
			return availableTabs;
		},
		get workspaceLayoutLabel() {
			return workspaceLayoutLabel;
		},
		get workspacePaneKinds() {
			return workspacePaneKinds;
		},
		get protocolsForHost() {
			return protocolsForHost;
		},
		get protocolForSelectedHost() {
			return protocolForSelectedHost;
		},
		get selectProtocol() {
			return selectProtocol;
		},
		get selectHost() {
			return selectHost;
		},
		get selectPaneHost() {
			return selectPaneHost;
		},
		get selectPaneKind() {
			return selectPaneKind;
		},
		get handleLiveSshLaunch() {
			return handleLiveSshLaunch;
		},
		get liveSshSessionsQuery() {
			return liveSshSessionsQuery;
		},
		get attachableLiveSshSessionsForHost() {
			return attachableLiveSshSessionsForHost;
		},
		get liveSshAttachByPaneId() {
			return liveSshAttachByPaneId;
		},
		get liveSshErrorForHost() {
			return liveSshErrorForHost;
		},
		get liveSshActionTitle() {
			return liveSshActionTitle;
		},
		get liveSshActionDetail() {
			return liveSshActionDetail;
		},
		get layoutPersistenceError() {
			return layoutPersistenceError;
		}
	};
}
