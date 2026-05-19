<script lang="ts">
	import { AlertTriangle, Clipboard, KeyRound, ShieldCheck, Unplug } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	type ConnectionState =
		| 'idle'
		| 'loading'
		| 'ready'
		| 'connecting'
		| 'connected'
		| 'disconnected'
		| 'error';

	let {
		sessionUsername = $bindable(''),
		sessionDomain = $bindable(''),
		sessionPassword = $bindable(''),
		connectionState,
		canConnect,
		submitConnect,
		gatewayPublicUrl,
		destination,
		targetCredentialState,
		clipboardPolicyDetail
	}: {
		sessionUsername: string;
		sessionDomain: string;
		sessionPassword: string;
		connectionState: ConnectionState;
		canConnect: boolean;
		submitConnect: (event: SubmitEvent) => void | Promise<void>;
		gatewayPublicUrl: string;
		destination: string;
		targetCredentialState: string;
		clipboardPolicyDetail: string;
	} = $props();
</script>

<div class="border-t bg-background p-3">
	<form class="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]" onsubmit={submitConnect}>
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
			<Label for="rdp-domain">Domain</Label>
			<Input
				id="rdp-domain"
				bind:value={sessionDomain}
				autocomplete="organization"
				placeholder="Optional domain"
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
			<span class="truncate">{gatewayPublicUrl}</span>
		</div>
		<div class="flex min-w-0 items-center gap-2">
			<Unplug class="size-4 shrink-0" />
			<span class="truncate">{destination}</span>
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
