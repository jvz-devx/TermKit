/* eslint-disable svelte/prefer-svelte-reactivity */
import { onMount } from 'svelte';
import type { UserInteraction } from '@devolutions/iron-remote-desktop';
import type { BadgeVariant } from '$lib/components/ui/badge';
import type { RdpClipboardPolicy, RdpPerformancePreset } from '$lib/settings.remote';
import { type SessionLaunch } from '$lib/termix.remote';
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
	createClipboardTelemetry,
	fileExceedsClipboardPolicy,
	formatBytes,
	nextClipboardTelemetry,
	type ClipboardTelemetry,
	type FileTransferState
} from './rdp-clipboard-transfer';
import {
	isGatewayExpired as isRdpGatewayExpired,
	lifecycleEventOnDispose,
	recordRdpLifecycleEvent
} from './rdp-lifecycle';
import {
	desktopSizeChanged,
	preferredDesktopSize as resolvePreferredDesktopSize,
	scaleFocusDetail
} from './rdp-display-sizing';
import { createRdpFocusHost } from './rdp-focus-host';

type RdpBackendModule = typeof import('@devolutions/iron-remote-desktop-rdp');
type ConnectionState = 'loading' | 'ready' | 'connecting' | 'connected' | 'error' | 'disconnected';
type IronReadyDetail = { irgUserInteraction?: UserInteraction };
type RdpClipboardData = {
	addBinary(mimeType: string, binary: Uint8Array): void;
	addText(mimeType: string, text: string): void;
	free?(): void;
};
type RdpSessionClipboardBridge = {
	onClipboardPaste(content: RdpClipboardData): Promise<void>;
};
type RdpGatewayFeatures = {
	audioRedirection?: boolean;
	audioRedirectionDisabledByEnv?: boolean;
	multiMonitor?: boolean;
};
type RdpBootstrapWithFeatures = NonNullable<SessionLaunch['rdp']> & {
	features?: RdpGatewayFeatures;
};
type TermixRdpGlobal = typeof globalThis & {
	__termixRdpClipboardCapture?: (session: RdpSessionClipboardBridge) => void;
	__termixRdpSessionCaptureInstalled?: boolean;
};

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
	let connectionState = $state<ConnectionState>('loading');
	let detail = $state('Loading IronRDP client.');
	let sessionUsername = $state('');
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

	const statusLabel = $derived(
		error
			? 'Launch failed'
			: connectionState === 'connected'
				? 'Connected'
				: connectionState === 'connecting'
					? 'Connecting'
					: connectionState === 'ready'
						? 'Gateway ready'
						: connectionState === 'disconnected'
							? 'Disconnected'
							: connectionState === 'error'
								? 'Client error'
								: 'Loading client'
	);
	const statusTitle = $derived(lastFailure?.title ?? statusLabel);
	const reconnectLabel = $derived(lastFailure?.reconnectLabel ?? 'Retry');
	const launchFailure = $derived(error ? classifyRdpFailure(error, { phase: 'connect' }) : null);
	const statusVariant: BadgeVariant = $derived(
		error || connectionState === 'error'
			? 'destructive'
			: connectionState === 'connected' || connectionState === 'ready'
				? 'secondary'
				: 'outline'
	);
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
	const audioStatusLabel = $derived(
		gatewayFeatures?.audioRedirectionDisabledByEnv
			? 'Audio disabled by deployment'
			: audioRedirection && gatewayFeatures?.audioRedirection
				? 'Audio requested'
				: audioRedirection
					? 'Audio unavailable'
					: 'Audio off'
	);
	const multiMonitorLabel = $derived(
		gatewayFeatures?.multiMonitor ? 'Multi-monitor ready' : 'Single monitor fallback'
	);
	const clipboardStatusLabel = $derived(
		automaticClipboardEnabled
			? 'Clipboard on'
			: effectiveClipboardPolicy.text || effectiveClipboardPolicy.files
				? 'Clipboard restricted'
				: 'Clipboard off'
	);
	const clipboardStatusVariant: BadgeVariant = $derived(
		automaticClipboardEnabled
			? 'secondary'
			: effectiveClipboardPolicy.text || effectiveClipboardPolicy.files
				? 'outline'
				: 'destructive'
	);
	const clipboardPolicyDetail = $derived(formatClipboardPolicyDetail(effectiveClipboardPolicy));
	const savedPasswordAvailable = $derived(
		rdpCredentials?.source === 'saved-password' &&
			Boolean(stagedSavedPassword) &&
			!savedPasswordCleared
	);
	const targetCredentialState = $derived.by(() => {
		if (savedPasswordAvailable) {
			return 'Saved RDP password is staged for this tab and will be cleared after connect.';
		}

		if (rdpCredentials?.unavailableReason) return rdpCredentials.unavailableReason;
		if (rdpCredentials?.source === 'saved-password') {
			return 'Saved RDP password is no longer staged; enter it locally to reconnect.';
		}

		return bootstrap?.credentialHint
			? 'Saved password is held server-side; enter it locally to connect.'
			: 'Enter the target RDP password locally to connect.';
	});
	const canConnect = $derived(
		Boolean(
			bootstrap &&
			api &&
			rdpModule &&
			(sessionPassword || stagedSavedPassword) &&
			connectionState !== 'connecting' &&
			connectionState !== 'connected'
		)
	);
	const fileTransferBusy = $derived(
		fileTransferState === 'copying' || fileTransferState === 'saving'
	);
	const canCopyFileToRemote = $derived(
		Boolean(
			effectiveClipboardPolicy.files &&
			effectiveClipboardPolicy.clientToRemote &&
			connectionState === 'connected' &&
			rdpModule &&
			activeClipboardSession &&
			!fileTransferBusy
		)
	);
	const canSaveRemoteClipboard = $derived(
		Boolean(
			effectiveClipboardPolicy.files &&
			effectiveClipboardPolicy.remoteToClient &&
			connectionState === 'connected' &&
			api &&
			!fileTransferBusy
		)
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
		stagedSavedPassword =
			rdpCredentials?.source === 'saved-password' ? (rdpCredentials.password ?? null) : null;
		if (stagedSavedPassword) onSavedPasswordStaged?.();
		void mountIronRdp();

		return () => {
			disposed = true;
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

			(globalThis as TermixRdpGlobal).__termixRdpClipboardCapture = (session) => {
				if (!disposed) activeClipboardSession = session;
			};
			installSessionCapture(backend);
			rdpModule = backend;
			webComponentReady = true;
			detail = 'Waiting for IronRDP client readiness.';
		} catch (caught) {
			lastFailure = classifyRdpFailure(caught, { phase: 'client' });
			connectionState = 'error';
			detail = lastFailure.detail;
			void recordRdpLifecycle('failed', lastFailure.code);
		}
	}

	function handleReady(event: Event) {
		const userInteraction = (event as CustomEvent<IronReadyDetail>).detail.irgUserInteraction;
		if (!userInteraction) {
			connectionState = 'error';
			detail = 'IronRDP client did not expose a session API.';
			void recordRdpLifecycle('failed', 'rdp_client_missing_session_api');
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
			const desktopSize = preferredDesktopSize();
			const builder = api
				.configBuilder()
				.withDestination(bootstrap.destination)
				.withProxyAddress(bootstrap.gatewayPublicUrl)
				.withAuthToken(bootstrap.associationToken)
				.withPassword(password)
				.withDesktopSize(desktopSize)
				.withExtension(rdpModule.preConnectionBlob(bootstrap.preconnectionBlob))
				.withExtension(rdpModule.enableCredssp(true))
				.withExtension(rdpModule.displayControl(true));

			if (username) builder.withUsername(username);
			if (bootstrap.identity.domain) builder.withServerDomain(bootstrap.identity.domain);

			clearLocalPasswordState();
			const session = await api.connect(builder.build());
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
					lastFailure = classifyRdpFailure(caught, {
						phase: 'run',
						gatewayExpired: isGatewayExpired()
					});
					connectionState = 'error';
					detail = lastFailure.detail;
					void recordRdpLifecycle('failed', lastFailure.code);
				});
		} catch (caught) {
			clearLocalPasswordState();
			lastFailure = classifyRdpFailure(caught, {
				phase: 'connect',
				gatewayExpired: isGatewayExpired()
			});
			connectionState = 'error';
			detail = lastFailure.detail;
			void recordRdpLifecycle('failed', lastFailure.code);
		}
	}

	function installSessionCapture(backend: RdpBackendModule) {
		const termixGlobal = globalThis as TermixRdpGlobal;
		if (termixGlobal.__termixRdpSessionCaptureInstalled) return;

		const sessionBuilder = backend.Backend.SessionBuilder as unknown as {
			prototype?: {
				connect?: (...args: unknown[]) => Promise<RdpSessionClipboardBridge>;
			};
		};
		const prototype = sessionBuilder.prototype;
		const originalConnect = prototype?.connect;
		if (!prototype || !originalConnect) return;

		const wrappedConnect = async function (this: unknown, ...args: unknown[]) {
			const session = await originalConnect.apply(this, args);
			(globalThis as TermixRdpGlobal).__termixRdpClipboardCapture?.(session);
			return session;
		};
		prototype.connect = wrappedConnect;
		termixGlobal.__termixRdpSessionCaptureInstalled = true;
	}

	function clearLocalPasswordState() {
		sessionPassword = '';
		stagedSavedPassword = null;
		savedPasswordCleared = true;
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

	function isGatewayExpired() {
		return isRdpGatewayExpired(bootstrap?.expiresAt);
	}

	function finalizeRdpLifecycleOnDispose() {
		const lifecycleEvent = lifecycleEventOnDispose(connectionState);
		if (lifecycleEvent) void recordRdpLifecycle(lifecycleEvent.event, lifecycleEvent.errorCode);
	}

	async function recordRdpLifecycle(
		event: 'connected' | 'ended' | 'failed',
		errorCode?: string
	): Promise<void> {
		const connectionSessionId = bootstrap?.connectionSessionId;
		if (!connectionSessionId) return;
		if (event !== 'connected') {
			if (lifecycleFinalized) return;
			lifecycleFinalized = true;
		}


		await recordRdpLifecycleEvent({ connectionSessionId, event, errorCode });
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

		if (fileExceedsClipboardPolicy(file, effectiveClipboardPolicy.fileTransferSizeLimitMiB)) {
			fileTransferState = 'failed';
			fileTransferDetail = `Selected file exceeds the ${effectiveClipboardPolicy.fileTransferSizeLimitMiB} MiB policy limit.`;
			pushClipboardTelemetry(
				createClipboardTelemetry({
					direction: 'client-to-remote',
					kind: 'file',
					status: 'failed',
					detail: `Rejected local file of ${formatBytes(file.size)} before clipboard transfer.`
				})
			);
			return;
		}

		fileTransferState = 'copying';
		fileTransferDetail = `Copying local file payload (${formatBytes(file.size)}) to the remote clipboard.`;
		pushClipboardTelemetry(
			createClipboardTelemetry({
				direction: 'client-to-remote',
				kind: 'file',
				status: 'copying',
				detail: `Copying local file payload (${formatBytes(file.size)}) to the remote clipboard.`
			})
		);

		const clipboardData = new rdpModule.Backend.ClipboardData();
		try {
			clipboardData.addText('text/plain', file.name);
			clipboardData.addBinary(
				file.type || 'application/octet-stream',
				new Uint8Array(await file.arrayBuffer())
			);
			await activeClipboardSession.onClipboardPaste(clipboardData);
			fileTransferState = 'complete';
			fileTransferDetail = `Local file payload (${formatBytes(file.size)}) is available through the RDP clipboard.`;
			pushClipboardTelemetry(
				createClipboardTelemetry({
					direction: 'client-to-remote',
					kind: 'file',
					status: 'complete',
					detail: `Local file payload (${formatBytes(file.size)}) reached the RDP clipboard.`
				})
			);
		} catch (caught) {
			fileTransferState = 'failed';
			fileTransferDetail = `Could not copy local file payload: ${errorMessage(caught)}`;
			pushClipboardTelemetry(
				createClipboardTelemetry({
					direction: 'client-to-remote',
					kind: 'file',
					status: 'failed',
					detail: `Local file clipboard transfer failed: ${errorMessage(caught)}`
				})
			);
		} finally {
			clipboardData.free?.();
		}
	}

	async function saveRemoteClipboardLocally() {
		if (!api) return;

		fileTransferState = 'saving';
		fileTransferDetail = 'Saving the remote clipboard payload to the browser clipboard.';
		pushClipboardTelemetry(
			createClipboardTelemetry({
				direction: 'remote-to-client',
				kind: 'unknown',
				status: 'saving',
				detail: 'Saving remote clipboard payload without inspecting contents.'
			})
		);
		try {
			await api.saveRemoteClipboardData();
			fileTransferState = 'complete';
			fileTransferDetail = 'Remote clipboard payload was copied to the browser clipboard.';
			pushClipboardTelemetry(
				createClipboardTelemetry({
					direction: 'remote-to-client',
					kind: 'unknown',
					status: 'complete',
					detail: 'Remote clipboard payload was copied to the browser clipboard.'
				})
			);
		} catch (caught) {
			fileTransferState = 'failed';
			fileTransferDetail = `Could not save remote clipboard data: ${errorMessage(caught)}`;
			pushClipboardTelemetry(
				createClipboardTelemetry({
					direction: 'remote-to-client',
					kind: 'unknown',
					status: 'failed',
					detail: `Remote clipboard save failed: ${errorMessage(caught)}`
				})
			);
		}
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
