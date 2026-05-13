<script lang="ts">
	import { AlertTriangle, ExternalLink, Monitor, ShieldCheck } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import StatePanel from '../StatePanel.svelte';
	import type { SessionLaunch } from '$lib/termix.remote';

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
	let targetCredentialState = $derived(
		bootstrap?.credential
			? `Target credential staged for ${bootstrap.credential.username ?? bootstrap.identity.username ?? 'user'}`
			: 'Target credential will be requested by the RDP client'
	);
</script>

<div class="flex h-full min-h-[480px] flex-col overflow-hidden rounded-md border bg-background">
	<div class="flex h-10 items-center justify-between border-b px-3">
		<div class="flex min-w-0 items-center gap-2">
			<Monitor class="size-4 shrink-0 text-muted-foreground" />
			<span class="truncate text-sm font-medium">RDP</span>
			<Badge variant={bootstrap ? 'secondary' : error ? 'destructive' : 'outline'}>
				{bootstrap ? 'Gateway ready' : error ? 'Launch failed' : 'Provisioning'}
			</Badge>
		</div>
		<Button size="sm" variant="outline" onclick={onReconnect}>Retry</Button>
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
			<div class="absolute inset-0 grid place-items-center bg-neutral-900">
				<div class="h-3/4 w-3/4 rounded-sm border border-neutral-800 bg-neutral-950"></div>
			</div>
			<StatePanel
				state="loading"
				title="Provisioning Gateway session"
				detail="Requesting a short-lived Devolutions Gateway association token."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else}
		<div class="grid min-h-0 flex-1 grid-rows-[1fr_auto] bg-neutral-950">
			<div class="grid place-items-center p-4">
				<div
					class="flex aspect-video w-full max-w-5xl items-center justify-center rounded-sm border border-neutral-800 bg-neutral-950 text-neutral-500"
				>
					<Monitor class="size-12" />
				</div>
			</div>

			<div class="border-t bg-background p-3">
				<div class="grid gap-3 md:grid-cols-3">
					<div class="rounded-md border bg-muted/20 p-3">
						<div class="mb-2 flex items-center gap-2 text-sm font-medium">
							<ShieldCheck class="size-4 text-muted-foreground" />
							Gateway
						</div>
						<p class="font-mono text-xs break-all text-muted-foreground">
							{bootstrap.gatewayPublicUrl}
						</p>
					</div>
					<div class="rounded-md border bg-muted/20 p-3">
						<div class="mb-2 flex items-center gap-2 text-sm font-medium">
							<ExternalLink class="size-4 text-muted-foreground" />
							Destination
						</div>
						<p class="font-mono text-xs break-all text-muted-foreground">
							{bootstrap.destination}
						</p>
					</div>
					<div class="rounded-md border bg-muted/20 p-3">
						<div class="mb-2 flex items-center gap-2 text-sm font-medium">
							<AlertTriangle class="size-4 text-muted-foreground" />
							Renderer
						</div>
						<p class="text-xs text-muted-foreground">
							IronRDP handoff data is ready. Canvas attachment is still pending the client package
							integration.
						</p>
					</div>
				</div>
				<div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
					<span>{bootstrap.desktop.width}x{bootstrap.desktop.height}</span>
					<span>Session {bootstrap.sessionId}</span>
					<span>{targetCredentialState}</span>
				</div>
			</div>
		</div>
	{/if}
</div>
