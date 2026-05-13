<script lang="ts">
	import { onMount } from 'svelte';
	import { KeyRound, ShieldCheck } from '@lucide/svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StatePanel from '../StatePanel.svelte';
	import RFB, { type RfbClient } from './novnc-rfb';

	type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
	type CredentialStrategy = 'none' | 'saved-password';
	type VncCredentials = {
		username: string | null;
		password: string | null;
	};

	let {
		websocketUrl,
		credentials,
		credentialStrategy = 'none',
		viewOnly = false
	}: {
		websocketUrl?: string;
		credentials?: VncCredentials;
		credentialStrategy?: CredentialStrategy;
		viewOnly?: boolean;
	} = $props();

	let mountElement: HTMLDivElement;
	let connectionState = $state<ConnectionState>('idle');
	let detail = $state('Waiting for VNC session ticket.');
	let desktopName = $state('VNC');
	let rfbClient = $state<RfbClient | null>(null);
	let authPromptVisible = $state(false);
	let authRequiredTypes = $state<string[]>([]);
	let defaultUsername = $derived(credentials?.username ?? '');
	let sessionUsername = $state('');
	let sessionPassword = $state('');
	let suppliedCredentials = $derived(toNoVncCredentials(credentials));
	let authSummary = $derived(
		credentialStrategy === 'saved-password'
			? 'saved password staged in browser memory'
			: credentials?.username
				? 'username staged'
				: 'credentials requested by target'
	);
	let authPromptDetail = $derived(
		credentialStrategy === 'saved-password'
			? 'The saved password was not enough for this VNC target. Enter credentials for this tab only; they are sent directly to noVNC and are not stored in the URL or session storage.'
			: 'Enter VNC credentials for this tab only. Passwords are sent directly to noVNC and are not stored in the URL or session storage.'
	);
	let canSubmitCredentials = $derived(Boolean(rfbClient && sessionPassword));

	onMount(() => {
		let rfb: RfbClient | undefined;
		let resizeObserver: ResizeObserver | undefined;

		if (!websocketUrl) {
			connectionState = 'idle';
			detail = 'Waiting for VNC session ticket.';
			return;
		}

		connectionState = 'connecting';
		detail = 'Opening VNC websocket.';
		rfb = new RFB(mountElement, websocketUrl, {
			shared: true,
			credentials: suppliedCredentials
		});
		rfbClient = rfb;
		rfb.viewOnly = viewOnly;
		rfb.focusOnClick = true;
		rfb.clipViewport = true;
		rfb.dragViewport = true;
		rfb.scaleViewport = true;
		rfb.resizeSession = true;
		rfb.showDotCursor = true;

		rfb.addEventListener('connect', () => {
			connectionState = 'connected';
			authPromptVisible = false;
			detail = 'VNC framebuffer is connected.';
			rfb?.focus();
		});
		rfb.addEventListener('disconnect', () => {
			connectionState = 'disconnected';
			authPromptVisible = false;
			detail = 'VNC session closed.';
		});
		rfb.addEventListener('securityfailure', () => {
			connectionState = 'error';
			authPromptVisible = false;
			detail =
				'VNC security negotiation failed. Reconnect the session if the target rejected the credentials.';
		});
		rfb.addEventListener('credentialsrequired', (event) => {
			connectionState = 'error';
			authPromptVisible = true;
			authRequiredTypes = event.detail?.types ?? [];
			sessionPassword = '';
			sessionUsername = sessionUsername || defaultUsername;
			detail =
				credentialStrategy === 'saved-password'
					? 'Saved VNC password was supplied, but the target requested more credentials.'
					: 'VNC password is required by the target.';
		});
		rfb.addEventListener('desktopname', (event) => {
			desktopName =
				event instanceof CustomEvent && typeof event.detail?.name === 'string'
					? event.detail.name
					: 'VNC';
		});

		resizeObserver = new ResizeObserver(() => {
			rfb!.scaleViewport = true;
			rfb!.resizeSession = true;
		});
		resizeObserver.observe(mountElement);

		return () => {
			resizeObserver?.disconnect();
			rfb?.disconnect();
			rfbClient = null;
		};
	});

	function submitCredentials(event: SubmitEvent) {
		event.preventDefault();
		if (!rfbClient || !sessionPassword) return;

		const username = sessionUsername.trim();
		rfbClient.sendCredentials({
			username: username || undefined,
			password: sessionPassword
		});
		sessionPassword = '';
		authPromptVisible = false;
		connectionState = 'connecting';
		detail = 'Submitting VNC credentials.';
	}

	function toNoVncCredentials(value: VncCredentials | undefined) {
		if (!value?.username && !value?.password) return undefined;

		return {
			username: value.username ?? undefined,
			password: value.password ?? undefined
		};
	}
</script>

<div class="relative h-full min-h-[480px] overflow-hidden rounded-md border bg-black">
	<div
		class="flex h-10 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-400"
	>
		<span class="font-medium text-neutral-100">{desktopName}</span>
		<div class="flex items-center gap-2">
			<Badge variant="outline" class="border-neutral-700 bg-neutral-900 text-neutral-300">
				{authSummary}
			</Badge>
			<span>{viewOnly ? 'view only' : 'interactive'}</span>
		</div>
	</div>
	<div bind:this={mountElement} class="h-[calc(100%-2.5rem)] w-full overflow-hidden"></div>

	{#if credentialStrategy === 'saved-password' && connectionState !== 'connected' && !authPromptVisible}
		<Alert.Root
			class="absolute top-[3.25rem] right-3 left-3 border-neutral-800 bg-neutral-950 text-neutral-100"
		>
			<ShieldCheck class="size-4" />
			<Alert.Title>Saved VNC password supplied</Alert.Title>
			<Alert.Description class="text-neutral-400">
				noVNC handles VNC authentication in the browser, so this launch keeps the saved password out
				of tickets, URLs, and session storage, but it is present in this tab until the VNC client
				disconnects.
			</Alert.Description>
		</Alert.Root>
	{/if}

	{#if authPromptVisible}
		<form
			class="absolute right-3 bottom-3 left-3 grid gap-3 rounded-md border bg-background p-3 shadow-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
			onsubmit={submitCredentials}
		>
			<div class="lg:col-span-3">
				<div class="flex items-center gap-2 text-sm font-medium">
					<KeyRound class="size-4" />
					VNC credentials required
				</div>
				<p class="mt-1 text-xs text-muted-foreground">{authPromptDetail}</p>
				{#if authRequiredTypes.length > 0}
					<p class="mt-1 text-xs text-muted-foreground">
						Requested by noVNC: {authRequiredTypes.join(', ')}
					</p>
				{/if}
			</div>
			<div class="grid gap-1.5">
				<Label for="vnc-username">Username</Label>
				<Input
					id="vnc-username"
					bind:value={sessionUsername}
					autocomplete="username"
					placeholder="Target username"
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="vnc-password">Password</Label>
				<Input
					id="vnc-password"
					type="password"
					bind:value={sessionPassword}
					autocomplete="current-password"
					placeholder="Required by the VNC target"
				/>
			</div>
			<div class="flex items-end">
				<Button type="submit" disabled={!canSubmitCredentials} class="w-full lg:w-auto">
					<KeyRound class="size-4" />
					Send
				</Button>
			</div>
		</form>
	{:else if connectionState !== 'connected'}
		<StatePanel
			state={connectionState === 'error'
				? 'error'
				: connectionState === 'disconnected'
					? 'disconnected'
					: 'loading'}
			title={connectionState === 'idle' ? 'Session ticket required' : 'VNC not connected'}
			{detail}
			class="absolute right-3 bottom-3 left-3 bg-background"
		/>
	{/if}
</div>
