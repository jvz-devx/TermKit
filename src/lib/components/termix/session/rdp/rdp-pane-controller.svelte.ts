import { onMount } from 'svelte';
import { SvelteURL } from 'svelte/reactivity';
import type { UserInteraction } from '@devolutions/iron-remote-desktop';
import type { RdpClipboardPolicy, RdpPerformancePreset } from '$lib/remotes/settings.remote';
import { type SessionLaunch } from '$lib/remotes/sessions.remote';
import {
	canEnableAutomaticClipboard,
	classifyRdpFailure,
	errorMessage,
	formatClipboardPolicyDetail,
	isRdpPerformancePreset,
	normalizeRdpClipboardPolicy,
	rdpDisplayPresets,
	rdpScaleValues,
	type RdpDesktopSize,
	type RdpFailureState,
	type RdpScaleMode
} from './rdp-operator-controls';
import {
	copyLocalFileToRemoteClipboard,
	createClipboardTelemetry,
	nextClipboardTelemetry,
	saveRemoteClipboardToBrowser,
	type ClipboardTelemetry,
	type FileTransferState,
	type RdpClipboardData,
	type RdpFileTransferUpdate
} from './rdp-clipboard-transfer';
import {
	isGatewayExpired as isRdpGatewayExpired,
	lifecycleEventOnDispose,
	recordRdpLifecycleEvent
} from './rdp-lifecycle';
import {
	installRdpSessionCapture,
	setRdpClipboardCapture,
	type RdpSessionCaptureBackend
} from './rdp-session-capture';
import {
	desktopSizeChanged,
	preferredDesktopSize as resolvePreferredDesktopSize,
	scaleFocusDetail
} from './rdp-display-sizing';
import { createRdpFocusHost } from './rdp-focus-host';
import {
	canCopyFileToRemoteClipboard,
	canSaveRemoteClipboardLocally,
	canStartRdpConnection,
	rdpAudioStatusLabel,
	rdpClipboardStatusLabel,
	rdpClipboardStatusVariant,
	rdpFileTransferBusy,
	rdpMultiMonitorLabel,
	rdpReconnectLabel,
	rdpSavedPasswordAvailable,
	rdpStatusLabel,
	rdpStatusTitle,
	rdpStatusVariant,
	rdpTargetCredentialState,
	type RdpBootstrapWithFeatures,
	type RdpConnectionState
} from './rdp-pane-state';

type RdpBackendModule = typeof import('@devolutions/iron-remote-desktop-rdp');
type IronReadyDetail = { irgUserInteraction?: UserInteraction };
type RdpSessionClipboardBridge = {
	onClipboardPaste(content: RdpClipboardData): Promise<void>;
};

const rdpConnectTimeoutMs = 30_000;

export type RdpPaneControllerProps = {
	launch: SessionLaunch | null;
	error: string | null;
	onReconnect: () => void;
	onSavedPasswordStaged?: () => void;
	clipboardSync?: boolean;
	clipboardPolicy?: RdpClipboardPolicy;
	performancePreset?: RdpPerformancePreset;
	audioRedirection?: boolean;
};

export function createRdpPaneController({
	launch,
	error,
	onReconnect,
	onSavedPasswordStaged,
	clipboardSync = true,
	clipboardPolicy,
	performancePreset = 'balanced',
	audioRedirection = false
}: RdpPaneControllerProps) {
	const bootstrap = $derived(launch?.rdp ?? null);
	let api = $state<UserInteraction | null>(null);
	let rdpModule = $state<RdpBackendModule | null>(null);
	let webComponentReady = $state(false);
	let connectionState = $state<RdpConnectionState>('loading');
	let detail = $state('Loading IronRDP client.');
	let sessionUsername = $state('');
	let sessionDomain = $state('');
	let sessionPassword = $state('');
	let stagedSavedPassword = $state<string | null>(null);
	let savedPasswordCleared = $state(false);
	let viewportElement = $state<HTMLDivElement | null>(null);
	let remoteDesktopElement = $state<HTMLElement | null>(null);
	let fileInputElement = $state<HTMLInputElement | null>(null);
	let activeClipboardSession = $state<RdpSessionClipboardBridge | null>(null);
	let fullscreenElement = $state<Element | null>(null);
	let activeElement = $state<Element | null>(null);
	let selectedPreset = $state<RdpPerformancePreset>('balanced');
	let selectedScale = $state<RdpScaleMode>('fit');
	let lastFailure = $state<RdpFailureState | null>(null);
	let clipboardTelemetry = $state<ClipboardTelemetry[]>([]);
	let fileTransferState = $state<FileTransferState>('idle');
	let fileTransferDetail = $state('No file clipboard transfer has run in this session.');
	let focusDetail = $state('Click the RDP canvas before typing remote shortcuts.');
	let resizeObserver: ResizeObserver | null = null;
	let resizeFrame: number | null = null;
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;
	let fullscreenResizeTimer: ReturnType<typeof setTimeout> | null = null;
	let lastDesktopSize: RdpDesktopSize | null = null;
	let lifecycleFinalized = false;
	let disposed = false;
	let connectAttemptId = 0;
	let connectTimeout: ReturnType<typeof setTimeout> | null = null;

	const statusLabel = $derived(rdpStatusLabel(error, connectionState));
	const statusTitle = $derived(rdpStatusTitle(lastFailure, statusLabel));
	const reconnectLabel = $derived(rdpReconnectLabel(lastFailure));
	const launchFailure = $derived(error ? classifyRdpFailure(error, { phase: 'connect' }) : null);
	const statusVariant = $derived(rdpStatusVariant(error, connectionState));
	const rdpCredentials = $derived(launch?.rdpCredentials ?? null);
	const gatewayFeatures = $derived((bootstrap as RdpBootstrapWithFeatures | null)?.features);
	const effectiveClipboardPolicy = $derived(
		normalizeRdpClipboardPolicy(clipboardPolicy, clipboardSync)
	);
	const automaticClipboardEnabled = $derived(canEnableAutomaticClipboard(effectiveClipboardPolicy));
	const selectedDisplayPreset = $derived(rdpDisplayPresets[selectedPreset]);
	const fullscreenActive = $derived(
		Boolean(viewportElement && fullscreenElement === viewportElement)
	);
	const rdpFocused = $derived(
		Boolean(
			(viewportElement && activeElement === viewportElement) ||
			(remoteDesktopElement && activeElement === remoteDesktopElement)
		)
	);
	const audioStatusLabel = $derived(rdpAudioStatusLabel(audioRedirection, gatewayFeatures));
	const multiMonitorLabel = $derived(rdpMultiMonitorLabel(gatewayFeatures));
	const clipboardStatusLabel = $derived(
		rdpClipboardStatusLabel(automaticClipboardEnabled, effectiveClipboardPolicy)
	);
	const clipboardStatusVariant = $derived(
		rdpClipboardStatusVariant(automaticClipboardEnabled, effectiveClipboardPolicy)
	);
	const clipboardPolicyDetail = $derived(formatClipboardPolicyDetail(effectiveClipboardPolicy));
	const savedPasswordAvailable = $derived(
		rdpSavedPasswordAvailable(rdpCredentials, stagedSavedPassword, savedPasswordCleared)
	);
	const targetCredentialState = $derived(
		rdpTargetCredentialState({ bootstrap, rdpCredentials, savedPasswordAvailable })
	);
	const canConnect = $derived(
		canStartRdpConnection({
			bootstrap,
			api,
			rdpModule,
			sessionPassword,
			stagedSavedPassword,
			connectionState
		})
	);
	const fileTransferBusy = $derived(rdpFileTransferBusy(fileTransferState));
	const canCopyFileToRemote = $derived(
		canCopyFileToRemoteClipboard({
			effectiveClipboardPolicy,
			connectionState,
			rdpModule,
			activeClipboardSession,
			fileTransferBusy
		})
	);
	const canSaveRemoteClipboard = $derived(
		canSaveRemoteClipboardLocally({
			effectiveClipboardPolicy,
			connectionState,
			api,
			fileTransferBusy
		})
	);

	onMount(() => {
		disposed = false;
		selectedPreset = isRdpPerformancePreset(performancePreset) ? performancePreset : 'balanced';
		selectedScale = rdpDisplayPresets[selectedPreset].scale;

		if (!bootstrap) {
			connectionState = 'loading';
			detail = 'Waiting for Gateway bootstrap.';
			return;
		}

		sessionUsername = rdpCredentials?.username ?? bootstrap.identity.username ?? '';
		sessionDomain = bootstrap.identity.domain ?? '';
		stagedSavedPassword =
			rdpCredentials?.source === 'saved-password' ? (rdpCredentials.password ?? null) : null;
		if (stagedSavedPassword) onSavedPasswordStaged?.();
		void mountIronRdp();

		return () => {
			disposed = true;
			clearConnectTimeout();
			stopResizeObserver();
			finalizeRdpLifecycleOnDispose();
			activeClipboardSession = null;
			api?.shutdown();
		};
	});

	async function mountIronRdp() {
		try {
			connectionState = 'loading';
			detail = 'Loading IronRDP web component.';
			await import('@devolutions/iron-remote-desktop');
			const backend = await import('@devolutions/iron-remote-desktop-rdp');
			await backend.init('INFO');
			if (disposed) return;

			setRdpClipboardCapture((session) => {
				if (!disposed) activeClipboardSession = session;
			});
			installRdpSessionCapture(backend as RdpSessionCaptureBackend);
			rdpModule = backend;
			webComponentReady = true;
			detail = 'Waiting for IronRDP client readiness.';
		} catch (caught) {
			const diagnostics = rdpFailureDiagnostics(caught, {
				phase: 'client',
				action: 'mountIronRdp'
			});
			lastFailure = classifyRdpFailure(caught, { phase: 'client' });
			connectionState = 'error';
			detail = lastFailure.detail;
			void recordRdpLifecycle('failed', lastFailure.code, diagnostics);
		}
	}

	function handleReady(event: Event) {
		const userInteraction = (event as CustomEvent<IronReadyDetail>).detail.irgUserInteraction;
		if (!userInteraction) {
			connectionState = 'error';
			detail = 'IronRDP client did not expose a session API.';
			void recordRdpLifecycle('failed', 'rdp_client_missing_session_api', {
				message: detail,
				details: {
					phase: 'client',
					action: 'handleReady',
					hasReadyDetail: Boolean((event as CustomEvent<IronReadyDetail>).detail)
				}
			});
			return;
		}

		api = userInteraction;
		api.setEnableAutoClipboard(automaticClipboardEnabled);
		api.onWarningCallback((warning) => {
			lastFailure = classifyRdpFailure(warning, { phase: 'client' });
			detail = lastFailure.detail;
		});
		api.onClipboardRemoteUpdateCallback(() => {
			pushClipboardTelemetry(
				createClipboardTelemetry({
					direction: 'remote-to-client',
					kind: 'unknown',
					status: 'ready',
					detail: 'Remote clipboard changed. Payload contents were not inspected.'
				})
			);
		});
		api.setKeyboardUnicodeMode(true);
		api.setVisibility(true);
		connectionState = 'ready';
		detail = targetCredentialState;
		focusRemoteDesktop();
		startResizeObserver();
	}

	async function connect() {
		const password = sessionPassword || stagedSavedPassword;
		if (!bootstrap || !api || !rdpModule || !password) return;

		try {
			connectionState = 'connecting';
			detail = 'Opening RDP session through Devolutions Gateway.';
			lastFailure = null;

			const username = sessionUsername.trim();
			const domain = sessionDomain.trim();
			const desktopSize = preferredDesktopSize();
			const proxyAddress = rdpGatewayWebSocketUrl(bootstrap.gatewayPublicUrl);
			const attemptId = ++connectAttemptId;
			clearConnectTimeout();
			console.info('RDP connect attempt started', {
				connectionSessionId: bootstrap.connectionSessionId,
				destination: bootstrap.destination,
				gatewayPublicUrl: bootstrap.gatewayPublicUrl,
				proxyAddress,
				usernameProvided: Boolean(username),
				domainProvided: Boolean(domain),
				domainValue: domain || null,
				desktop: desktopSize,
				expiresAt: bootstrap.expiresAt
			});
			connectTimeout = setTimeout(() => {
				if (disposed || attemptId !== connectAttemptId || connectionState !== 'connecting') return;
				const diagnostics = rdpConnectDiagnostics('api.connect', {
					message: `RDP connect timed out after ${rdpConnectTimeoutMs}ms`,
					proxyAddress,
					desktop: desktopSize
				});
				lastFailure = {
					kind: 'client-error',
					code: 'rdp_connect_timeout',
					title: 'RDP connect timed out',
					detail:
						'The Gateway websocket opened, but the RDP handshake did not finish in time. Check Gateway and target RDP logs.',
					reconnectLabel: 'Retry'
				};
				connectionState = 'error';
				detail = lastFailure.detail;
				void recordRdpLifecycle('failed', lastFailure.code, diagnostics);
			}, rdpConnectTimeoutMs);
			const builder = api
				.configBuilder()
				.withDestination(bootstrap.destination)
				.withProxyAddress(proxyAddress)
				.withAuthToken(bootstrap.associationToken)
				.withPassword(password)
				.withDesktopSize(desktopSize)
				.withExtension(rdpModule.preConnectionBlob(bootstrap.preconnectionBlob))
				.withExtension(rdpModule.enableCredssp(true))
				.withExtension(rdpModule.displayControl(true));

			if (username) builder.withUsername(username);
			if (domain) builder.withServerDomain(domain);

			clearLocalPasswordState();
			const session = await api.connect(builder.build());
			if (disposed || attemptId !== connectAttemptId || connectionState !== 'connecting') return;
			clearConnectTimeout();
			console.info('RDP connect attempt completed', {
				connectionSessionId: bootstrap.connectionSessionId,
				destination: bootstrap.destination,
				proxyAddress
			});
			connectionState = 'connected';
			lastDesktopSize = desktopSize;
			detail = 'RDP canvas is connected.';
			focusDetail = 'Keyboard and pointer focus are on the RDP canvas.';
			void recordRdpLifecycle('connected');
			focusRemoteDesktop();
			applyScaleMode(selectedScale);
			scheduleRemoteResize(true);

			void session
				.run()
				.then((termination) => {
					if (disposed) return;
					activeClipboardSession = null;
					lastFailure = classifyRdpFailure(termination.reason(), {
						phase: 'run',
						gatewayExpired: isGatewayExpired()
					});
					connectionState = 'disconnected';
					detail = lastFailure.detail;
					void recordRdpLifecycle('ended');
				})
				.catch((caught: unknown) => {
					if (disposed) return;
					activeClipboardSession = null;
					const diagnostics = rdpFailureDiagnostics(caught, {
						phase: 'run',
						action: 'session.run',
						gatewayExpired: isGatewayExpired()
					});
					lastFailure = classifyRdpFailure(caught, {
						phase: 'run',
						gatewayExpired: isGatewayExpired()
					});
					connectionState = 'error';
					detail = lastFailure.detail;
					void recordRdpLifecycle('failed', lastFailure.code, diagnostics);
				});
		} catch (caught) {
			clearConnectTimeout();
			clearLocalPasswordState();
			const diagnostics = rdpFailureDiagnostics(caught, {
				phase: 'connect',
				action: 'api.connect',
				gatewayExpired: isGatewayExpired()
			});
			lastFailure = classifyRdpFailure(caught, {
				phase: 'connect',
				gatewayExpired: isGatewayExpired()
			});
			connectionState = 'error';
			detail = lastFailure.detail;
			void recordRdpLifecycle('failed', lastFailure.code, diagnostics);
		}
	}

	function clearLocalPasswordState() {
		sessionPassword = '';
		stagedSavedPassword = null;
		savedPasswordCleared = true;
	}

	function clearConnectTimeout() {
		if (!connectTimeout) return;
		clearTimeout(connectTimeout);
		connectTimeout = null;
	}

	function submitConnect(event: SubmitEvent) {
		event.preventDefault();
		void connect();
	}

	function startResizeObserver() {
		if (!viewportElement || resizeObserver) return;

		resizeObserver = new ResizeObserver(() => {
			scheduleRemoteResize();
		});
		resizeObserver.observe(viewportElement);
	}

	function stopResizeObserver() {
		if (resizeFrame !== null) {
			cancelAnimationFrame(resizeFrame);
			resizeFrame = null;
		}
		if (resizeTimer !== null) {
			clearTimeout(resizeTimer);
			resizeTimer = null;
		}
		if (fullscreenResizeTimer !== null) {
			clearTimeout(fullscreenResizeTimer);
			fullscreenResizeTimer = null;
		}

		resizeObserver?.disconnect();
		resizeObserver = null;
	}

	function scheduleRemoteResize(force = false) {
		if (resizeTimer !== null) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			resizeTimer = null;
			scheduleResizeFrame(force);
		}, selectedDisplayPreset.resizeDebounceMs);
	}

	function scheduleResizeFrame(force = false) {
		if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);

		resizeFrame = requestAnimationFrame(() => {
			resizeFrame = null;
			resizeRemoteDesktop(force);
		});
	}

	function scheduleFullscreenResize() {
		scheduleRemoteResize(true);
		if (fullscreenResizeTimer !== null) clearTimeout(fullscreenResizeTimer);
		fullscreenResizeTimer = setTimeout(() => {
			fullscreenResizeTimer = null;
			scheduleRemoteResize(true);
		}, 160);
	}

	function handleFullscreenChange() {
		scheduleFullscreenResize();
	}

	function resizeRemoteDesktop(force = false) {
		if (!api || connectionState !== 'connected') return;

		const nextSize = preferredDesktopSize();
		if (!desktopSizeChanged(lastDesktopSize, nextSize, force)) {
			return;
		}

		lastDesktopSize = nextSize;
		try {
			api.resize(nextSize.width, nextSize.height, 100);
			focusDetail = `Remote display resized to ${nextSize.width} x ${nextSize.height}.`;
		} catch (caught) {
			console.warn('Could not resize RDP desktop', caught);
		}
	}

	function preferredDesktopSize(): RdpDesktopSize {
		const rect = viewportElement?.getBoundingClientRect();
		const fallback = bootstrap?.desktop ?? { width: 1440, height: 900 };

		return resolvePreferredDesktopSize({ viewportRect: rect, fallback, preset: selectedPreset });
	}

	function focusRemoteDesktop() {
		(remoteDesktopElement ?? viewportElement)?.focus({ preventScroll: true });
		api?.setVisibility(true);
		api?.setKeyboardUnicodeMode(true);
		focusDetail = 'Keyboard and pointer focus are on the RDP canvas.';
	}

	function handleViewportPointerDown() {
		focusRemoteDesktop();
	}

	function handleViewportKeydown() {
		// IronRDP captures keyboard input from the focused canvas wrapper.
	}

	const rdpFocusHost = createRdpFocusHost({
		onPointerDown: handleViewportPointerDown,
		onFocus: focusRemoteDesktop,
		onKeydown: handleViewportKeydown
	});

	function applyScaleMode(scale: RdpScaleMode) {
		selectedScale = scale;
		api?.setScale(rdpScaleValues[scale]);
		focusDetail = scaleFocusDetail(scale);
	}

	function changePreset(next: string) {
		if (!isRdpPerformancePreset(next)) return;
		selectedPreset = next;
		applyScaleMode(rdpDisplayPresets[next].scale);
		scheduleRemoteResize(true);
	}

	function changeScale(next: string) {
		if (next !== 'fit' && next !== 'fill' && next !== 'real') return;
		applyScaleMode(next);
	}

	async function toggleFullscreen() {
		if (!viewportElement) return;

		try {
			if (fullscreenActive) {
				await document.exitFullscreen();
				scheduleFullscreenResize();
				focusDetail = 'Fullscreen exited.';
				focusRemoteDesktop();
				return;
			}

			await viewportElement.requestFullscreen();
			scheduleFullscreenResize();
			focusDetail = 'Fullscreen active. Press Escape to exit.';
			focusRemoteDesktop();
		} catch {
			focusDetail = 'Fullscreen was blocked by the browser.';
		}
	}

	function disconnectRdpSession() {
		activeClipboardSession = null;
		api?.shutdown();
		connectionState = 'disconnected';
		detail = 'Disconnected locally. Reconnect to create a new RDP session.';
		lastFailure = {
			kind: 'remote-disconnect',
			code: 'rdp_local_disconnect',
			title: 'Disconnected',
			detail,
			reconnectLabel: 'Reconnect'
		};
		void recordRdpLifecycle('ended');
	}

	function sendCtrlAltDel() {
		api?.ctrlAltDel();
		focusRemoteDesktop();
		focusDetail = 'Sent Ctrl+Alt+Del to the remote session.';
	}

	function sendWindowsKey() {
		api?.metaKey();
		focusRemoteDesktop();
		focusDetail = 'Sent Windows key to the remote session.';
	}

	function requestClipboardPush() {
		void api
			?.sendClipboardData()
			.then(() => {
				pushClipboardTelemetry(
					createClipboardTelemetry({
						direction: 'client-to-remote',
						kind: effectiveClipboardPolicy.text ? 'text' : 'unknown',
						status: 'complete',
						detail: 'Browser clipboard sync was requested. Payload contents were not logged.'
					})
				);
			})
			.catch((caught) => {
				pushClipboardTelemetry(
					createClipboardTelemetry({
						direction: 'client-to-remote',
						kind: 'unknown',
						status: 'failed',
						detail: `Clipboard sync failed: ${errorMessage(caught)}`
					})
				);
			});
	}

	function pushClipboardTelemetry(entry: ClipboardTelemetry) {
		clipboardTelemetry = nextClipboardTelemetry(clipboardTelemetry, entry);
	}

	function applyFileTransferUpdate(update: RdpFileTransferUpdate) {
		fileTransferState = update.state;
		fileTransferDetail = update.detail;
		pushClipboardTelemetry(update.telemetry);
	}

	function isGatewayExpired() {
		return isRdpGatewayExpired(bootstrap?.expiresAt);
	}

	function rdpFailureDiagnostics(
		caught: unknown,
		context: {
			phase: 'connect' | 'run' | 'client';
			action: string;
			gatewayExpired?: boolean;
		}
	) {
		const message = errorMessage(caught);
		return {
			message,
			details: {
				...context,
				errorType: errorTypeName(caught),
				errorString: safeDiagnosticString(caught),
				ironErrorKind: ironErrorKind(caught),
				connectionState,
				destination: bootstrap?.destination ?? null,
				gatewayPublicUrl: bootstrap?.gatewayPublicUrl ?? null,
				proxyAddress: bootstrap ? rdpGatewayWebSocketUrl(bootstrap.gatewayPublicUrl) : null,
				expiresAt: bootstrap?.expiresAt ?? null,
				usernameProvided: Boolean(sessionUsername.trim()),
				domainProvided: Boolean(sessionDomain.trim()),
				domainValue: sessionDomain.trim() || null,
				usingSavedPassword: Boolean(stagedSavedPassword),
				desktop: preferredDesktopSize(),
				userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent
			}
		};
	}

	function rdpConnectDiagnostics(
		action: string,
		input: { message: string; proxyAddress: string; desktop: RdpDesktopSize }
	) {
		return {
			message: input.message,
			details: {
				phase: 'connect',
				action,
				gatewayExpired: isGatewayExpired(),
				connectionState,
				destination: bootstrap?.destination ?? null,
				gatewayPublicUrl: bootstrap?.gatewayPublicUrl ?? null,
				proxyAddress: input.proxyAddress,
				expiresAt: bootstrap?.expiresAt ?? null,
				usernameProvided: Boolean(sessionUsername.trim()),
				domainProvided: Boolean(sessionDomain.trim()),
				domainValue: sessionDomain.trim() || null,
				usingSavedPassword: Boolean(stagedSavedPassword),
				desktop: input.desktop,
				timeoutMs: rdpConnectTimeoutMs,
				userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent
			}
		};
	}

	function errorTypeName(value: unknown) {
		if (value instanceof Error) return value.name;
		if (value === null) return 'null';
		return typeof value;
	}

	function ironErrorKind(value: unknown) {
		if (
			value &&
			typeof value === 'object' &&
			typeof (value as { kind?: unknown }).kind === 'function'
		) {
			try {
				return String((value as { kind: () => unknown }).kind());
			} catch {
				return 'kind_unavailable';
			}
		}

		return null;
	}

	function safeDiagnosticString(value: unknown) {
		try {
			return String(value);
		} catch {
			return 'unstringifiable_error';
		}
	}

	function rdpGatewayWebSocketUrl(gatewayPublicUrl: string) {
		const url = new SvelteURL(gatewayPublicUrl);
		url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
		url.pathname = `${url.pathname.replace(/\/$/, '')}/jet/rdp`;
		url.search = '';
		url.hash = '';
		return url.toString();
	}

	function finalizeRdpLifecycleOnDispose() {
		const lifecycleEvent = lifecycleEventOnDispose(connectionState);
		if (lifecycleEvent) void recordRdpLifecycle(lifecycleEvent.event, lifecycleEvent.errorCode);
	}

	async function recordRdpLifecycle(
		event: 'connected' | 'ended' | 'failed',
		errorCode?: string,
		diagnostics?: { message: string; details: Record<string, unknown> }
	): Promise<void> {
		const connectionSessionId = bootstrap?.connectionSessionId;
		if (!connectionSessionId) return;
		if (event !== 'connected') {
			if (lifecycleFinalized) return;
			lifecycleFinalized = true;
		}

		await recordRdpLifecycleEvent({
			connectionSessionId,
			event,
			errorCode,
			errorMessage: diagnostics?.message,
			errorDetails: diagnostics?.details
		});
	}

	function pickFileForRemoteClipboard() {
		fileInputElement?.click();
	}

	async function copyFileToRemoteClipboard(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!rdpModule || !activeClipboardSession) {
			fileTransferState = 'failed';
			fileTransferDetail = 'The RDP session is not ready for file clipboard transfer.';
			return;
		}

		const currentRdpModule = rdpModule;
		const clipboardSession = activeClipboardSession;
		await copyLocalFileToRemoteClipboard({
			file,
			limitMiB: effectiveClipboardPolicy.fileTransferSizeLimitMiB,
			createClipboardData: () => new currentRdpModule.Backend.ClipboardData(),
			paste: (content) => clipboardSession.onClipboardPaste(content),
			onUpdate: applyFileTransferUpdate
		});
	}

	async function saveRemoteClipboardLocally() {
		if (!api) return;

		const currentApi = api;
		await saveRemoteClipboardToBrowser({
			save: () => currentApi.saveRemoteClipboardData(),
			onUpdate: applyFileTransferUpdate
		});
	}

	return {
		get fullscreenElement() {
			return fullscreenElement;
		},
		set fullscreenElement(value) {
			fullscreenElement = value;
		},
		get activeElement() {
			return activeElement;
		},
		set activeElement(value) {
			activeElement = value;
		},
		get handleFullscreenChange() {
			return handleFullscreenChange;
		},
		get statusVariant() {
			return statusVariant;
		},
		get statusTitle() {
			return statusTitle;
		},
		get clipboardStatusVariant() {
			return clipboardStatusVariant;
		},
		get clipboardStatusLabel() {
			return clipboardStatusLabel;
		},
		get selectedDisplayPreset() {
			return selectedDisplayPreset;
		},
		get multiMonitorLabel() {
			return multiMonitorLabel;
		},
		get audioRedirection() {
			return audioRedirection;
		},
		get gatewayFeatures() {
			return gatewayFeatures;
		},
		get audioStatusLabel() {
			return audioStatusLabel;
		},
		get api() {
			return api;
		},
		get viewportElement() {
			return viewportElement;
		},
		set viewportElement(value) {
			viewportElement = value;
		},
		get connectionState() {
			return connectionState;
		},
		get fullscreenActive() {
			return fullscreenActive;
		},
		get selectedPreset() {
			return selectedPreset;
		},
		get selectedScale() {
			return selectedScale;
		},
		get reconnectLabel() {
			return reconnectLabel;
		},
		get sendCtrlAltDel() {
			return sendCtrlAltDel;
		},
		get sendWindowsKey() {
			return sendWindowsKey;
		},
		get focusRemoteDesktop() {
			return focusRemoteDesktop;
		},
		get scheduleRemoteResize() {
			return scheduleRemoteResize;
		},
		get toggleFullscreen() {
			return toggleFullscreen;
		},
		get changePreset() {
			return changePreset;
		},
		get changeScale() {
			return changeScale;
		},
		get onReconnect() {
			return onReconnect;
		},
		get disconnectRdpSession() {
			return disconnectRdpSession;
		},
		get error() {
			return error;
		},
		get launchFailure() {
			return launchFailure;
		},
		get bootstrap() {
			return bootstrap;
		},
		get webComponentReady() {
			return webComponentReady;
		},
		get rdpModule() {
			return rdpModule;
		},
		get remoteDesktopElement() {
			return remoteDesktopElement;
		},
		set remoteDesktopElement(value) {
			remoteDesktopElement = value;
		},
		get handleReady() {
			return handleReady;
		},
		get rdpFocusHost() {
			return rdpFocusHost;
		},
		get detail() {
			return detail;
		},
		get rdpFocused() {
			return rdpFocused;
		},
		get focusDetail() {
			return focusDetail;
		},
		get fileInputElement() {
			return fileInputElement;
		},
		set fileInputElement(value) {
			fileInputElement = value;
		},
		get fileTransferState() {
			return fileTransferState;
		},
		get fileTransferDetail() {
			return fileTransferDetail;
		},
		get clipboardPolicyDetail() {
			return clipboardPolicyDetail;
		},
		get effectiveClipboardPolicy() {
			return effectiveClipboardPolicy;
		},
		get canCopyFileToRemote() {
			return canCopyFileToRemote;
		},
		get canSaveRemoteClipboard() {
			return canSaveRemoteClipboard;
		},
		get clipboardTelemetry() {
			return clipboardTelemetry;
		},
		get copyFileToRemoteClipboard() {
			return copyFileToRemoteClipboard;
		},
		get pickFileForRemoteClipboard() {
			return pickFileForRemoteClipboard;
		},
		get saveRemoteClipboardLocally() {
			return saveRemoteClipboardLocally;
		},
		get requestClipboardPush() {
			return requestClipboardPush;
		},
		get sessionUsername() {
			return sessionUsername;
		},
		set sessionUsername(value) {
			sessionUsername = value;
		},
		get sessionDomain() {
			return sessionDomain;
		},
		set sessionDomain(value) {
			sessionDomain = value;
		},
		get sessionPassword() {
			return sessionPassword;
		},
		set sessionPassword(value) {
			sessionPassword = value;
		},
		get canConnect() {
			return canConnect;
		},
		get submitConnect() {
			return submitConnect;
		},
		get targetCredentialState() {
			return targetCredentialState;
		}
	};
}
