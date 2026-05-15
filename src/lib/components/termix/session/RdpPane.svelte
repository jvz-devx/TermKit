<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AlertTriangle,
		Clipboard,
		Command,
		FileDown,
		FileUp,
		Gauge,
		Keyboard,
		KeyRound,
		Maximize2,
		Minimize2,
		Monitor,
		MonitorUp,
		MonitorX,
		MousePointer2,
		Power,
		RefreshCw,
		Scan,
		ShieldCheck,
		Unplug,
		Volume2,
		VolumeX
	} from '@lucide/svelte';
	import type { UserInteraction } from '@devolutions/iron-remote-desktop';
	import type { Action } from 'svelte/action';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import StatePanel from '../StatePanel.svelte';
	import type { RdpClipboardPolicy, RdpPerformancePreset } from '$lib/settings.remote';
	import { recordRdpSessionLifecycle, type SessionLaunch } from '$lib/termix.remote';
	import {
		applyRdpDisplayPreset,
		canEnableAutomaticClipboard,
		classifyRdpFailure,
		errorMessage,
		formatClipboardPolicyDetail,
		isRdpPerformancePreset,
		normalizeDesktopDimension,
		normalizeRdpClipboardPolicy,
		rdpDisplayPresets,
		rdpScaleValues,
		type RdpDesktopSize,
		type RdpFailureState,
		type RdpScaleMode
	} from './rdp-operator-controls';

	type RdpBackendModule = typeof import('@devolutions/iron-remote-desktop-rdp');
	type ConnectionState =
		| 'loading'
		| 'ready'
		| 'connecting'
		| 'connected'
		| 'error'
		| 'disconnected';
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
	type FileTransferState = 'idle' | 'copying' | 'saving' | 'complete' | 'failed';
	type ClipboardTelemetry = {
		direction: 'client-to-remote' | 'remote-to-client';
		kind: 'text' | 'file' | 'mixed' | 'unknown';
		status: 'ready' | 'copying' | 'saving' | 'complete' | 'failed';
		detail: string;
		at: string;
	};

	const minDesktopWidth = 2;
	const minDesktopHeight = 1;
	const maxDesktopWidth = 7680;
	const maxDesktopHeight = 4320;

	let {
		launch,
		error,
		onReconnect,
		onSavedPasswordStaged,
		clipboardSync = true,
		clipboardPolicy,
		performancePreset = 'balanced',
		audioRedirection = false
	}: {
		launch: SessionLaunch | null;
		error: string | null;
		onReconnect: () => void;
		onSavedPasswordStaged?: () => void;
		clipboardSync?: boolean;
		clipboardPolicy?: RdpClipboardPolicy;
		performancePreset?: RdpPerformancePreset;
		audioRedirection?: boolean;
	} = $props();

	let bootstrap = $derived(launch?.rdp ?? null);
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

	let statusLabel = $derived(
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
	let statusTitle = $derived(lastFailure?.title ?? statusLabel);
	let reconnectLabel = $derived(lastFailure?.reconnectLabel ?? 'Retry');
	let launchFailure = $derived(error ? classifyRdpFailure(error, { phase: 'connect' }) : null);
	let statusVariant: BadgeVariant = $derived(
		error || connectionState === 'error'
			? 'destructive'
			: connectionState === 'connected' || connectionState === 'ready'
				? 'secondary'
				: 'outline'
	);
	let rdpCredentials = $derived(launch?.rdpCredentials ?? null);
	let gatewayFeatures = $derived((bootstrap as RdpBootstrapWithFeatures | null)?.features);
	let effectiveClipboardPolicy = $derived(
		normalizeRdpClipboardPolicy(clipboardPolicy, clipboardSync)
	);
	let automaticClipboardEnabled = $derived(canEnableAutomaticClipboard(effectiveClipboardPolicy));
	let selectedDisplayPreset = $derived(rdpDisplayPresets[selectedPreset]);
	let fullscreenActive = $derived(
		Boolean(viewportElement && fullscreenElement === viewportElement)
	);
	let rdpFocused = $derived(
		Boolean(
			(viewportElement && activeElement === viewportElement) ||
			(remoteDesktopElement && activeElement === remoteDesktopElement)
		)
	);
	let FullscreenIcon = $derived(fullscreenActive ? Minimize2 : Maximize2);
	let AudioIcon = $derived(
		audioRedirection && gatewayFeatures?.audioRedirection ? Volume2 : VolumeX
	);
	let audioStatusLabel = $derived(
		gatewayFeatures?.audioRedirectionDisabledByEnv
			? 'Audio disabled by deployment'
			: audioRedirection && gatewayFeatures?.audioRedirection
				? 'Audio requested'
				: audioRedirection
					? 'Audio unavailable'
					: 'Audio off'
	);
	let multiMonitorLabel = $derived(
		gatewayFeatures?.multiMonitor ? 'Multi-monitor ready' : 'Single monitor fallback'
	);
	let clipboardStatusLabel = $derived(
		automaticClipboardEnabled
			? 'Clipboard on'
			: effectiveClipboardPolicy.text || effectiveClipboardPolicy.files
				? 'Clipboard restricted'
				: 'Clipboard off'
	);
	let clipboardStatusVariant: BadgeVariant = $derived(
		automaticClipboardEnabled
			? 'secondary'
			: effectiveClipboardPolicy.text || effectiveClipboardPolicy.files
				? 'outline'
				: 'destructive'
	);
	let clipboardPolicyDetail = $derived(formatClipboardPolicyDetail(effectiveClipboardPolicy));
	let savedPasswordAvailable = $derived(
		rdpCredentials?.source === 'saved-password' &&
			Boolean(stagedSavedPassword) &&
			!savedPasswordCleared
	);
	let targetCredentialState = $derived.by(() => {
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
	let canConnect = $derived(
		Boolean(
			bootstrap &&
			api &&
			rdpModule &&
			(sessionPassword || stagedSavedPassword) &&
			connectionState !== 'connecting' &&
			connectionState !== 'connected'
		)
	);
	let fileTransferBusy = $derived(
		fileTransferState === 'copying' || fileTransferState === 'saving'
	);
	let canCopyFileToRemote = $derived(
		Boolean(
			effectiveClipboardPolicy.files &&
			effectiveClipboardPolicy.clientToRemote &&
			connectionState === 'connected' &&
			rdpModule &&
			activeClipboardSession &&
			!fileTransferBusy
		)
	);
	let canSaveRemoteClipboard = $derived(
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
			pushClipboardTelemetry({
				direction: 'remote-to-client',
				kind: 'unknown',
				status: 'ready',
				detail: 'Remote clipboard changed. Payload contents were not inspected.',
				at: new Date().toISOString()
			});
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
		if (
			!force &&
			lastDesktopSize?.width === nextSize.width &&
			lastDesktopSize.height === nextSize.height
		) {
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

		const rawSize = {
			width: normalizeDesktopDimension(
				rect?.width ?? fallback.width,
				minDesktopWidth,
				maxDesktopWidth,
				true
			),
			height: normalizeDesktopDimension(
				rect?.height ?? fallback.height,
				minDesktopHeight,
				maxDesktopHeight,
				false
			)
		};
		return applyRdpDisplayPreset(rawSize, selectedPreset);
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

	const rdpFocusHost: Action<HTMLElement> = (node) => {
		node.addEventListener('pointerdown', handleViewportPointerDown);
		node.addEventListener('focus', focusRemoteDesktop);
		node.addEventListener('keydown', handleViewportKeydown);

		return {
			destroy() {
				node.removeEventListener('pointerdown', handleViewportPointerDown);
				node.removeEventListener('focus', focusRemoteDesktop);
				node.removeEventListener('keydown', handleViewportKeydown);
			}
		};
	};

	function applyScaleMode(scale: RdpScaleMode) {
		selectedScale = scale;
		api?.setScale(rdpScaleValues[scale]);
		focusDetail =
			scale === 'fit'
				? 'Display scale set to fit.'
				: scale === 'fill'
					? 'Display scale set to fill.'
					: 'Display scale set to 100%.';
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
				pushClipboardTelemetry({
					direction: 'client-to-remote',
					kind: effectiveClipboardPolicy.text ? 'text' : 'unknown',
					status: 'complete',
					detail: 'Browser clipboard sync was requested. Payload contents were not logged.',
					at: new Date().toISOString()
				});
			})
			.catch((caught) => {
				pushClipboardTelemetry({
					direction: 'client-to-remote',
					kind: 'unknown',
					status: 'failed',
					detail: `Clipboard sync failed: ${errorMessage(caught)}`,
					at: new Date().toISOString()
				});
			});
	}

	function pushClipboardTelemetry(entry: ClipboardTelemetry) {
		clipboardTelemetry = [entry, ...clipboardTelemetry].slice(0, 4);
	}

	function isGatewayExpired() {
		if (!bootstrap?.expiresAt) return false;
		return Date.now() >= new Date(bootstrap.expiresAt).getTime();
	}

	function finalizeRdpLifecycleOnDispose() {
		if (connectionState === 'error') {
			void recordRdpLifecycle('failed', 'rdp_client_pane_abandoned_error');
			return;
		}

		if (
			connectionState === 'loading' ||
			connectionState === 'ready' ||
			connectionState === 'connecting' ||
			connectionState === 'connected' ||
			connectionState === 'disconnected'
		) {
			void recordRdpLifecycle('ended');
		}
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

		await recordRdpSessionLifecycle({ connectionSessionId, event, errorCode }).catch((caught) => {
			console.warn('Could not record RDP lifecycle event', caught);
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

		const maxBytes = effectiveClipboardPolicy.fileTransferSizeLimitMiB * 1024 * 1024;
		if (file.size > maxBytes) {
			fileTransferState = 'failed';
			fileTransferDetail = `Selected file exceeds the ${effectiveClipboardPolicy.fileTransferSizeLimitMiB} MiB policy limit.`;
			pushClipboardTelemetry({
				direction: 'client-to-remote',
				kind: 'file',
				status: 'failed',
				detail: `Rejected local file of ${formatBytes(file.size)} before clipboard transfer.`,
				at: new Date().toISOString()
			});
			return;
		}

		fileTransferState = 'copying';
		fileTransferDetail = `Copying local file payload (${formatBytes(file.size)}) to the remote clipboard.`;
		pushClipboardTelemetry({
			direction: 'client-to-remote',
			kind: 'file',
			status: 'copying',
			detail: `Copying local file payload (${formatBytes(file.size)}) to the remote clipboard.`,
			at: new Date().toISOString()
		});

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
			pushClipboardTelemetry({
				direction: 'client-to-remote',
				kind: 'file',
				status: 'complete',
				detail: `Local file payload (${formatBytes(file.size)}) reached the RDP clipboard.`,
				at: new Date().toISOString()
			});
		} catch (caught) {
			fileTransferState = 'failed';
			fileTransferDetail = `Could not copy local file payload: ${errorMessage(caught)}`;
			pushClipboardTelemetry({
				direction: 'client-to-remote',
				kind: 'file',
				status: 'failed',
				detail: `Local file clipboard transfer failed: ${errorMessage(caught)}`,
				at: new Date().toISOString()
			});
		} finally {
			clipboardData.free?.();
		}
	}

	async function saveRemoteClipboardLocally() {
		if (!api) return;

		fileTransferState = 'saving';
		fileTransferDetail = 'Saving the remote clipboard payload to the browser clipboard.';
		pushClipboardTelemetry({
			direction: 'remote-to-client',
			kind: 'unknown',
			status: 'saving',
			detail: 'Saving remote clipboard payload without inspecting contents.',
			at: new Date().toISOString()
		});
		try {
			await api.saveRemoteClipboardData();
			fileTransferState = 'complete';
			fileTransferDetail = 'Remote clipboard payload was copied to the browser clipboard.';
			pushClipboardTelemetry({
				direction: 'remote-to-client',
				kind: 'unknown',
				status: 'complete',
				detail: 'Remote clipboard payload was copied to the browser clipboard.',
				at: new Date().toISOString()
			});
		} catch (caught) {
			fileTransferState = 'failed';
			fileTransferDetail = `Could not save remote clipboard data: ${errorMessage(caught)}`;
			pushClipboardTelemetry({
				direction: 'remote-to-client',
				kind: 'unknown',
				status: 'failed',
				detail: `Remote clipboard save failed: ${errorMessage(caught)}`,
				at: new Date().toISOString()
			});
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const mib = bytes / 1024 / 1024;
		return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
	}
</script>

<svelte:document
	bind:fullscreenElement
	bind:activeElement
	onfullscreenchange={handleFullscreenChange}
/>

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-background">
	<div
		class="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5"
	>
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<Monitor class="size-4 shrink-0 text-muted-foreground" />
			<span class="truncate text-sm font-medium">RDP</span>
			<Badge variant={statusVariant} class="shrink truncate">{statusTitle}</Badge>
			<Badge variant={clipboardStatusVariant} class="shrink truncate">{clipboardStatusLabel}</Badge>
			<Badge variant="outline" class="shrink truncate">
				<Gauge class="size-3" />
				{selectedDisplayPreset.label}
			</Badge>
			<Badge variant="outline" class="hidden shrink truncate md:inline-flex">
				<MonitorUp class="size-3" />
				{multiMonitorLabel}
			</Badge>
			<Badge
				variant={audioRedirection && gatewayFeatures?.audioRedirection ? 'secondary' : 'outline'}
				class="hidden shrink truncate lg:inline-flex"
			>
				<AudioIcon class="size-3" />
				{audioStatusLabel}
			</Badge>
		</div>
		<div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
			<Button
				size="icon-sm"
				variant="ghost"
				onclick={sendCtrlAltDel}
				disabled={!api || connectionState !== 'connected'}
				aria-label="Send Ctrl Alt Delete"
				title="Send Ctrl+Alt+Del"
			>
				<Keyboard class="size-4" />
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				onclick={sendWindowsKey}
				disabled={!api || connectionState !== 'connected'}
				aria-label="Send Windows key"
				title="Send Windows key"
			>
				<Command class="size-4" />
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				onclick={focusRemoteDesktop}
				disabled={!api}
				aria-label="Focus RDP canvas"
				title="Focus RDP canvas"
			>
				<MousePointer2 class="size-4" />
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				onclick={() => scheduleRemoteResize(true)}
				disabled={!api || connectionState !== 'connected'}
				aria-label="Resize remote display"
				title="Resize remote display"
			>
				<Scan class="size-4" />
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				onclick={toggleFullscreen}
				disabled={!viewportElement}
				aria-label={fullscreenActive ? 'Exit RDP fullscreen' : 'Enter RDP fullscreen'}
				title={fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'}
			>
				<FullscreenIcon class="size-4" />
			</Button>
			<NativeSelect.Root
				size="sm"
				class="hidden w-[8.75rem] sm:block"
				value={selectedPreset}
				onchange={(event) => changePreset(event.currentTarget.value)}
				aria-label="RDP quality preset"
			>
				<NativeSelect.Option value="balanced">Balanced</NativeSelect.Option>
				<NativeSelect.Option value="performance">Performance</NativeSelect.Option>
				<NativeSelect.Option value="quality">Quality</NativeSelect.Option>
			</NativeSelect.Root>
			<NativeSelect.Root
				size="sm"
				class="hidden w-[7.25rem] lg:block"
				value={selectedScale}
				onchange={(event) => changeScale(event.currentTarget.value)}
				aria-label="RDP display scale"
			>
				<NativeSelect.Option value="fit">Fit</NativeSelect.Option>
				<NativeSelect.Option value="fill">Fill</NativeSelect.Option>
				<NativeSelect.Option value="real">100%</NativeSelect.Option>
			</NativeSelect.Root>
			<Button size="sm" variant="outline" onclick={onReconnect}>
				<RefreshCw class="size-4" />
				{reconnectLabel}
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				onclick={disconnectRdpSession}
				disabled={!api || connectionState === 'disconnected'}
				aria-label="Disconnect RDP session"
				title="Disconnect RDP session"
			>
				<Power class="size-4" />
			</Button>
		</div>
	</div>

	{#if error}
		<div class="relative min-h-0 min-w-0 flex-1">
			<StatePanel
				state="error"
				title={launchFailure?.title ?? 'RDP launch failed'}
				detail={`${launchFailure?.detail ?? error} Diagnostic: ${launchFailure?.code ?? error}`}
				class="absolute right-3 bottom-3 left-3 bg-background"
			>
				<Button size="sm" onclick={onReconnect}>
					<RefreshCw class="size-4" />
					{launchFailure?.reconnectLabel ?? 'Retry RDP'}
				</Button>
			</StatePanel>
		</div>
	{:else if !bootstrap}
		<div class="relative min-h-0 min-w-0 flex-1 bg-neutral-950">
			<StatePanel
				state="loading"
				title="Provisioning Gateway session"
				detail="Requesting a short-lived Devolutions Gateway association token."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else}
		<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-950">
			<div
				class="relative min-h-0 min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
				bind:this={viewportElement}
			>
				<div class="h-full w-full min-w-0 overflow-hidden">
					{#if webComponentReady && rdpModule}
						<svelte:element
							this={'iron-remote-desktop'}
							bind:this={remoteDesktopElement}
							module={rdpModule.Backend}
							scale={selectedScale}
							flexcenter="true"
							onready={handleReady}
							tabindex="0"
							role="application"
							aria-label="RDP remote desktop canvas"
							use:rdpFocusHost
							class="block h-full w-full"
						/>
					{/if}
				</div>

				{#if connectionState !== 'connected'}
					<StatePanel
						state={connectionState === 'error'
							? 'error'
							: connectionState === 'disconnected'
								? 'disconnected'
								: 'loading'}
						title={connectionState === 'ready' ? 'RDP credentials required' : statusTitle}
						{detail}
						class="absolute right-3 bottom-3 left-3 bg-background"
					/>
				{/if}
			</div>

			<div class="border-t bg-background px-3 py-2">
				<div class="grid gap-2 text-xs text-muted-foreground lg:grid-cols-[1.2fr_1fr_1fr]">
					<div class="flex min-w-0 items-center gap-2">
						<MousePointer2 class="size-4 shrink-0" />
						<span class="truncate">
							{rdpFocused ? focusDetail : 'RDP canvas is not focused. Click it before typing.'}
						</span>
					</div>
					<div class="flex min-w-0 items-center gap-2">
						<MonitorX class="size-4 shrink-0" />
						<span class="truncate">{multiMonitorLabel}; extra monitor routing is not exposed.</span>
					</div>
					<div class="flex min-w-0 items-center gap-2">
						<AudioIcon class="size-4 shrink-0" />
						<span class="truncate">{audioStatusLabel}</span>
					</div>
				</div>
			</div>

			{#if connectionState === 'connected'}
				<div class="border-t bg-background p-3">
					<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<Clipboard class="size-4 text-muted-foreground" />
								<p class="text-sm font-medium">RDP clipboard feedback</p>
							</div>
							<p
								class:text-destructive={fileTransferState === 'failed'}
								class="mt-1 truncate text-xs text-muted-foreground"
							>
								{effectiveClipboardPolicy.files ? fileTransferDetail : clipboardPolicyDetail}
							</p>
						</div>
						<input
							bind:this={fileInputElement}
							type="file"
							class="hidden"
							onchange={copyFileToRemoteClipboard}
							aria-label="Choose file for RDP clipboard"
						/>
						<Button
							size="sm"
							variant="outline"
							disabled={!canCopyFileToRemote || !effectiveClipboardPolicy.files}
							onclick={pickFileForRemoteClipboard}
						>
							<FileUp class="size-4" />
							Copy file to remote
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={!canSaveRemoteClipboard || !effectiveClipboardPolicy.files}
							onclick={saveRemoteClipboardLocally}
						>
							<FileDown class="size-4" />
							Save remote clipboard
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={!api ||
								!effectiveClipboardPolicy.text ||
								!effectiveClipboardPolicy.clientToRemote}
							onclick={requestClipboardPush}
						>
							<Clipboard class="size-4" />
							Sync text
						</Button>
					</div>

					{#if clipboardTelemetry.length}
						<div class="mt-3 grid gap-2 md:grid-cols-2">
							{#each clipboardTelemetry as entry (entry.at + entry.direction)}
								<div class="rounded-md border bg-muted/20 px-2.5 py-2 text-xs">
									<div class="flex items-center justify-between gap-2">
										<span class="font-medium">
											{entry.direction === 'client-to-remote'
												? 'Client to remote'
												: 'Remote to client'}
										</span>
										<Badge variant={entry.status === 'failed' ? 'destructive' : 'outline'}>
											{entry.status}
										</Badge>
									</div>
									<p class="mt-1 text-muted-foreground">{entry.detail}</p>
								</div>
							{/each}
						</div>
					{:else}
						<p class="mt-3 text-xs text-muted-foreground">
							Clipboard telemetry records direction, size, and status only; clipboard contents are
							not inspected or logged.
						</p>
					{/if}
				</div>
			{:else}
				<div class="border-t bg-background p-3">
					<form class="grid gap-3 lg:grid-cols-[1fr_1fr_auto]" onsubmit={submitConnect}>
						<div class="grid gap-1.5">
							<Label for="rdp-username">Username</Label>
							<Input
								id="rdp-username"
								bind:value={sessionUsername}
								autocomplete="username"
								placeholder="Target username"
								disabled={connectionState === 'connecting'}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="rdp-password">Session password</Label>
							<Input
								id="rdp-password"
								type="password"
								bind:value={sessionPassword}
								autocomplete="current-password"
								placeholder="Required by the RDP target"
								disabled={connectionState === 'connecting'}
							/>
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={!canConnect} class="w-full lg:w-auto">
								<KeyRound class="size-4" />
								Connect
							</Button>
						</div>
					</form>

					<div class="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-4">
						<div class="flex min-w-0 items-center gap-2">
							<ShieldCheck class="size-4 shrink-0" />
							<span class="truncate">{bootstrap.gatewayPublicUrl}</span>
						</div>
						<div class="flex min-w-0 items-center gap-2">
							<Unplug class="size-4 shrink-0" />
							<span class="truncate">{bootstrap.destination}</span>
						</div>
						<div class="flex min-w-0 items-center gap-2">
							<AlertTriangle class="size-4 shrink-0" />
							<span class="truncate">{targetCredentialState}</span>
						</div>
						<div class="flex min-w-0 items-center gap-2">
							<Clipboard class="size-4 shrink-0" />
							<span class="truncate">{clipboardPolicyDetail}</span>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
