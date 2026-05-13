<script lang="ts">
	import { onMount } from 'svelte';
	import { AlertTriangle, KeyRound, Monitor, RotateCw, ShieldCheck, Unplug } from '@lucide/svelte';
	import type { UserInteraction } from '@devolutions/iron-remote-desktop';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StatePanel from '../StatePanel.svelte';
	import type { SessionLaunch } from '$lib/termix.remote';

	type RdpBackendModule = typeof import('@devolutions/iron-remote-desktop-rdp');
	type ConnectionState =
		| 'loading'
		| 'ready'
		| 'connecting'
		| 'connected'
		| 'error'
		| 'disconnected';
	type IronReadyDetail = { irgUserInteraction?: UserInteraction };

	let {
		launch,
		error,
		onReconnect
	}: {
		launch: SessionLaunch | null;
		error: string | null;
		onReconnect: () => void;
	} = $props();

	let bootstrap = $derived(launch?.rdp ?? null);
	let api = $state<UserInteraction | null>(null);
	let rdpModule = $state<RdpBackendModule | null>(null);
	let webComponentReady = $state(false);
	let connectionState = $state<ConnectionState>('loading');
	let detail = $state('Loading IronRDP client.');
	let sessionUsername = $state('');
	let sessionPassword = $state('');
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
	let targetCredentialState = $derived(
		bootstrap?.credentialHint
			? 'Saved password is held server-side; enter it locally to connect.'
			: 'Enter the target RDP password locally to connect.'
	);
	let canConnect = $derived(
		Boolean(
			bootstrap &&
			api &&
			rdpModule &&
			sessionPassword &&
			connectionState !== 'connecting' &&
			connectionState !== 'connected'
		)
	);

	onMount(() => {
		disposed = false;

		if (!bootstrap) {
			connectionState = 'loading';
			detail = 'Waiting for Gateway bootstrap.';
			return;
		}

		sessionUsername = bootstrap.identity.username ?? '';
		void mountIronRdp();

		return () => {
			disposed = true;
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

			rdpModule = backend;
			webComponentReady = true;
			detail = 'Waiting for IronRDP client readiness.';
		} catch (caught) {
			connectionState = 'error';
			detail = `Could not load IronRDP client: ${errorMessage(caught)}`;
		}
	}

	function handleReady(event: Event) {
		const userInteraction = (event as CustomEvent<IronReadyDetail>).detail.irgUserInteraction;
		if (!userInteraction) {
			connectionState = 'error';
			detail = 'IronRDP client did not expose a session API.';
			return;
		}

		api = userInteraction;
		api.setEnableAutoClipboard(false);
		api.setVisibility(true);
		connectionState = 'ready';
		detail = targetCredentialState;
	}

	async function connect() {
		if (!bootstrap || !api || !rdpModule || !sessionPassword) return;

		try {
			connectionState = 'connecting';
			detail = 'Opening RDP session through Devolutions Gateway.';

			const username = sessionUsername.trim();
			const builder = api
				.configBuilder()
				.withDestination(bootstrap.destination)
				.withProxyAddress(bootstrap.gatewayPublicUrl)
				.withAuthToken(bootstrap.associationToken)
				.withPassword(sessionPassword)
				.withDesktopSize(bootstrap.desktop)
				.withExtension(rdpModule.preConnectionBlob(bootstrap.preconnectionBlob))
				.withExtension(rdpModule.enableCredssp(true))
				.withExtension(rdpModule.displayControl(true));

			if (username) builder.withUsername(username);
			if (bootstrap.identity.domain) builder.withServerDomain(bootstrap.identity.domain);

			const session = await api.connect(builder.build());
			sessionPassword = '';
			connectionState = 'connected';
			detail = 'RDP canvas is connected.';

			void session
				.run()
				.then((termination) => {
					if (disposed) return;
					connectionState = 'disconnected';
					detail = `RDP session ended: ${termination.reason()}`;
				})
				.catch((caught: unknown) => {
					if (disposed) return;
					connectionState = 'error';
					detail = `RDP session failed: ${errorMessage(caught)}`;
				});
		} catch (caught) {
			connectionState = 'error';
			detail = `Could not connect RDP session: ${errorMessage(caught)}`;
		}
	}

	function submitConnect(event: SubmitEvent) {
		event.preventDefault();
		void connect();
	}

	function errorMessage(value: unknown): string {
		return value instanceof Error ? value.message : String(value);
	}
</script>

<div class="flex h-full min-h-[480px] flex-col overflow-hidden rounded-md border bg-background">
	<div class="flex h-10 shrink-0 items-center justify-between border-b px-3">
		<div class="flex min-w-0 items-center gap-2">
			<Monitor class="size-4 shrink-0 text-muted-foreground" />
			<span class="truncate text-sm font-medium">RDP</span>
			<Badge variant={statusVariant}>{statusLabel}</Badge>
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
		<div class="grid min-h-0 flex-1 grid-rows-[1fr_auto] bg-neutral-950">
			<div class="relative min-h-0">
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

			<div class="border-t bg-background p-3">
				<form class="grid gap-3 lg:grid-cols-[1fr_1fr_auto]" onsubmit={submitConnect}>
					<div class="grid gap-1.5">
						<Label for="rdp-username">Username</Label>
						<Input
							id="rdp-username"
							bind:value={sessionUsername}
							autocomplete="username"
							placeholder="Target username"
							disabled={connectionState === 'connecting' || connectionState === 'connected'}
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
							disabled={connectionState === 'connecting' || connectionState === 'connected'}
						/>
					</div>
					<div class="flex items-end">
						<Button type="submit" disabled={!canConnect} class="w-full lg:w-auto">
							<KeyRound class="size-4" />
							Connect
						</Button>
					</div>
				</form>

				<div class="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
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
				</div>
			</div>
		</div>
	{/if}
</div>
