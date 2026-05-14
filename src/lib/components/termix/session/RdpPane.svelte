<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AlertTriangle,
		Clipboard,
		FileDown,
		FileUp,
		KeyRound,
		Monitor,
		RotateCw,
		ShieldCheck,
		Unplug
	} from '@lucide/svelte';
	import type { UserInteraction } from '@devolutions/iron-remote-desktop';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StatePanel from '../StatePanel.svelte';
	import type { RdpClipboardPolicy } from '$lib/settings.remote';
	import { recordRdpSessionLifecycle, type SessionLaunch } from '$lib/termix.remote';

	type RdpBackendModule = typeof import('@devolutions/iron-remote-desktop-rdp');
	type ConnectionState =
		| 'loading'
		| 'ready'
		| 'connecting'
		| 'connected'
		| 'error'
		| 'disconnected';
	type IronReadyDetail = { irgUserInteraction?: UserInteraction };
	type RdpDesktopSize = { width: number; height: number };
	type RdpClipboardData = {
		addBinary(mimeType: string, binary: Uint8Array): void;
		addText(mimeType: string, text: string): void;
		free?(): void;
	};
	type RdpSessionClipboardBridge = {
		onClipboardPaste(content: RdpClipboardData): Promise<void>;
	};
	type TermixRdpGlobal = typeof globalThis & {
		__termixRdpClipboardCapture?: (session: RdpSessionClipboardBridge) => void;
		__termixRdpSessionCaptureInstalled?: boolean;
	};
	type FileTransferState = 'idle' | 'copying' | 'saving' | 'complete' | 'failed';

	const minDesktopWidth = 2;
	const minDesktopHeight = 1;
	const maxDesktopWidth = 7680;
	const maxDesktopHeight = 4320;
	const defaultRdpClipboardPolicy: RdpClipboardPolicy = {
		text: true,
		files: false,
		clientToRemote: true,
		remoteToClient: true,
		fileTransferSizeLimitMiB: 16
	};

	let {
		launch,
		error,
		onReconnect,
		onSavedPasswordStaged,
		clipboardSync = true,
		clipboardPolicy
	}: {
		launch: SessionLaunch | null;
		error: string | null;
		onReconnect: () => void;
		onSavedPasswordStaged?: () => void;
		clipboardSync?: boolean;
		clipboardPolicy?: RdpClipboardPolicy;
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
	let fileInputElement = $state<HTMLInputElement | null>(null);
	let activeClipboardSession = $state<RdpSessionClipboardBridge | null>(null);
	let fileTransferState = $state<FileTransferState>('idle');
	let fileTransferDetail = $state('No file clipboard transfer has run in this session.');
	let resizeObserver: ResizeObserver | null = null;
	let resizeFrame: number | null = null;
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
	let statusVariant: BadgeVariant = $derived(
		error || connectionState === 'error'
			? 'destructive'
			: connectionState === 'connected' || connectionState === 'ready'
				? 'secondary'
				: 'outline'
	);
	let rdpCredentials = $derived(launch?.rdpCredentials ?? null);
	let effectiveClipboardPolicy = $derived(normalizeClipboardPolicy(clipboardPolicy, clipboardSync));
	let automaticClipboardEnabled = $derived(canEnableAutomaticClipboard(effectiveClipboardPolicy));
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
			connectionState = 'error';
			detail = `Could not load IronRDP client: ${errorMessage(caught)}`;
			void recordRdpLifecycle('failed', rdpClientErrorCode(caught));
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
		api.setVisibility(true);
		connectionState = 'ready';
		detail = targetCredentialState;
		startResizeObserver();
	}

	async function connect() {
		const password = sessionPassword || stagedSavedPassword;
		if (!bootstrap || !api || !rdpModule || !password) return;

		try {
			connectionState = 'connecting';
			detail = 'Opening RDP session through Devolutions Gateway.';

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
			void recordRdpLifecycle('connected');
			scheduleRemoteResize(true);

			void session
				.run()
				.then((termination) => {
					if (disposed) return;
					activeClipboardSession = null;
					connectionState = 'disconnected';
					detail = `RDP session ended: ${termination.reason()}`;
					void recordRdpLifecycle('ended');
				})
				.catch((caught: unknown) => {
					if (disposed) return;
					activeClipboardSession = null;
					connectionState = 'error';
					detail = `RDP session failed: ${errorMessage(caught)}`;
					void recordRdpLifecycle('failed', rdpClientErrorCode(caught));
				});
		} catch (caught) {
			clearLocalPasswordState();
			connectionState = 'error';
			detail = `Could not connect RDP session: ${errorMessage(caught)}`;
			void recordRdpLifecycle('failed', rdpClientErrorCode(caught));
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

	function errorMessage(value: unknown): string {
		return value instanceof Error ? value.message : String(value);
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

		resizeObserver?.disconnect();
		resizeObserver = null;
	}

	function scheduleRemoteResize(force = false) {
		if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);

		resizeFrame = requestAnimationFrame(() => {
			resizeFrame = null;
			resizeRemoteDesktop(force);
		});
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
		} catch (caught) {
			console.warn('Could not resize RDP desktop', caught);
		}
	}

	function preferredDesktopSize(): RdpDesktopSize {
		const rect = viewportElement?.getBoundingClientRect();
		const fallback = bootstrap?.desktop ?? { width: 1440, height: 900 };

		return {
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
	}

	function normalizeDesktopDimension(
		value: number,
		minimum: number,
		maximum: number,
		requireEven: boolean
	): number {
		const clamped = Math.min(maximum, Math.max(minimum, Math.round(value)));
		return requireEven && clamped % 2 === 1 ? clamped - 1 : clamped;
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

	function rdpClientErrorCode(value: unknown): string {
		const message = errorMessage(value)
			.toLowerCase()
			.replace(/[^a-z0-9_:-]+/g, '_');
		return `rdp_client_${message}`.slice(0, 120);
	}

	function normalizeClipboardPolicy(
		policy: RdpClipboardPolicy | undefined,
		legacyClipboardSync: boolean
	): RdpClipboardPolicy {
		const normalizedPolicy = policy ?? {
			...defaultRdpClipboardPolicy,
			text: legacyClipboardSync,
			clientToRemote: legacyClipboardSync,
			remoteToClient: legacyClipboardSync
		};
		const hasPayloads = normalizedPolicy.text || normalizedPolicy.files;
		if (!hasPayloads) {
			return {
				...normalizedPolicy,
				clientToRemote: false,
				remoteToClient: false
			};
		}

		return normalizedPolicy;
	}

	function canEnableAutomaticClipboard(policy: RdpClipboardPolicy): boolean {
		return policy.text && policy.clientToRemote && policy.remoteToClient;
	}

	function formatClipboardPolicyDetail(policy: RdpClipboardPolicy): string {
		if (!policy.text && !policy.files) return 'Clipboard is disabled by application policy.';

		const parts = [
			policy.text ? 'Text clipboard allowed.' : 'Text clipboard disabled.',
			policy.files
				? `File clipboard reserved with a ${policy.fileTransferSizeLimitMiB} MiB limit.`
				: 'File clipboard disabled.'
		];

		if (!policy.clientToRemote) parts.push('Client to remote is blocked.');
		if (!policy.remoteToClient) parts.push('Remote to client is blocked.');
		if (!canEnableAutomaticClipboard(policy)) {
			parts.push('Automatic clipboard sync is off while restrictions are active.');
		}

		return parts.join(' ');
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
			fileTransferDetail = `${file.name} is larger than the ${effectiveClipboardPolicy.fileTransferSizeLimitMiB} MiB policy limit.`;
			return;
		}

		fileTransferState = 'copying';
		fileTransferDetail = `Copying ${file.name} to the remote clipboard.`;

		const clipboardData = new rdpModule.Backend.ClipboardData();
		try {
			clipboardData.addText('text/plain', file.name);
			clipboardData.addBinary(
				file.type || 'application/octet-stream',
				new Uint8Array(await file.arrayBuffer())
			);
			await activeClipboardSession.onClipboardPaste(clipboardData);
			fileTransferState = 'complete';
			fileTransferDetail = `${file.name} is available through the RDP clipboard.`;
		} catch (caught) {
			fileTransferState = 'failed';
			fileTransferDetail = `Could not copy ${file.name}: ${errorMessage(caught)}`;
		} finally {
			clipboardData.free?.();
		}
	}

	async function saveRemoteClipboardLocally() {
		if (!api) return;

		fileTransferState = 'saving';
		fileTransferDetail = 'Saving the remote clipboard payload to the browser clipboard.';
		try {
			await api.saveRemoteClipboardData();
			fileTransferState = 'complete';
			fileTransferDetail = 'Remote clipboard payload was copied to the browser clipboard.';
		} catch (caught) {
			fileTransferState = 'failed';
			fileTransferDetail = `Could not save remote clipboard data: ${errorMessage(caught)}`;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-background">
	<div class="flex h-10 shrink-0 items-center justify-between border-b px-3">
		<div class="flex min-w-0 items-center gap-2">
			<Monitor class="size-4 shrink-0 text-muted-foreground" />
			<span class="truncate text-sm font-medium">RDP</span>
			<Badge variant={statusVariant} class="shrink truncate">{statusLabel}</Badge>
			<Badge variant={clipboardStatusVariant} class="shrink truncate">{clipboardStatusLabel}</Badge>
		</div>
		<Button size="sm" variant="outline" onclick={onReconnect}>
			<RotateCw class="size-4" />
			Retry
		</Button>
	</div>

	{#if error}
		<div class="relative min-h-0 flex-1">
			<StatePanel
				state="error"
				title="RDP launch failed"
				detail={error}
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else if !bootstrap}
		<div class="relative min-h-0 flex-1 bg-neutral-950">
			<StatePanel
				state="loading"
				title="Provisioning Gateway session"
				detail="Requesting a short-lived Devolutions Gateway association token."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col bg-neutral-950">
			<div class="relative min-h-0 flex-1" bind:this={viewportElement}>
				<div class="h-full w-full overflow-hidden">
					{#if webComponentReady && rdpModule}
						<svelte:element
							this={'iron-remote-desktop'}
							module={rdpModule.Backend}
							scale="fit"
							flexcenter="true"
							onready={handleReady}
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
						title={connectionState === 'ready' ? 'RDP credentials required' : 'RDP not connected'}
						{detail}
						class="absolute right-3 bottom-3 left-3 bg-background"
					/>
				{/if}
			</div>

			{#if connectionState === 'connected' && effectiveClipboardPolicy.files}
				<div class="border-t bg-background p-3">
					<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<Clipboard class="size-4 text-muted-foreground" />
								<p class="text-sm font-medium">RDP file clipboard</p>
							</div>
							<p
								class:text-destructive={fileTransferState === 'failed'}
								class="mt-1 truncate text-xs text-muted-foreground"
							>
								{fileTransferDetail}
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
							disabled={!canCopyFileToRemote}
							onclick={pickFileForRemoteClipboard}
						>
							<FileUp class="size-4" />
							Copy file to remote
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={!canSaveRemoteClipboard}
							onclick={saveRemoteClipboardLocally}
						>
							<FileDown class="size-4" />
							Save remote clipboard
						</Button>
					</div>
				</div>
			{:else if connectionState !== 'connected'}
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
