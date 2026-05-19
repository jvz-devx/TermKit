<script lang="ts">
	import { AlertTriangle, Clipboard, KeyRound, ShieldCheck, Unplug } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
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

	let credentialsDialogOpen = $state(true);
	const promptAvailable = $derived(
		connectionState === 'ready' || connectionState === 'error' || connectionState === 'disconnected'
	);

	function handleSubmit(event: SubmitEvent) {
		void submitConnect(event);
		if (canConnect) credentialsDialogOpen = false;
	}
</script>

<div class="border-t bg-background p-3">
	<div class="grid gap-2 text-xs text-muted-foreground md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
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
		<div class="flex items-center justify-start md:justify-end">
			<Button
				type="button"
				size="sm"
				disabled={!promptAvailable}
				onclick={() => (credentialsDialogOpen = true)}
			>
				<KeyRound class="size-4" />
				Credentials
			</Button>
		</div>
	</div>
</div>

{#if promptAvailable}
	<Dialog.Root bind:open={credentialsDialogOpen}>
		<Dialog.Content class="max-w-lg">
			<Dialog.Header>
				<Dialog.Title>RDP credentials required</Dialog.Title>
				<Dialog.Description>
					Enter the target RDP credentials for this browser session.
				</Dialog.Description>
			</Dialog.Header>
			<form class="grid gap-4" onsubmit={handleSubmit}>
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
						placeholder="DOMAIN"
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
						autofocus
					/>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (credentialsDialogOpen = false)}>
						Cancel
					</Button>
					<Button type="submit" disabled={!canConnect}>
						<KeyRound class="size-4" />
						Connect
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
{/if}
