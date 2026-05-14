<script lang="ts">
	import { Fingerprint, KeyRound, ShieldAlert } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		enrollSshHostKey,
		inspectSshHostKeyTrust,
		listHosts,
		type HostSummary,
		type SshHostKeyTrustSummary
	} from '$lib/termix.remote';

	let {
		host,
		onEnrolled
	}: {
		host: HostSummary;
		onEnrolled?: () => void | Promise<void>;
	} = $props();

	let trust = $state<SshHostKeyTrustSummary | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function inspect() {
		busy = true;
		error = null;
		try {
			trust = await inspectSshHostKeyTrust(host.id);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not inspect SSH host key trust';
		} finally {
			busy = false;
		}
	}

	async function enroll() {
		busy = true;
		error = null;
		try {
			trust = await enrollSshHostKey(host.id).updates(listHosts);
			await onEnrolled?.();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not enroll SSH host key';
		} finally {
			busy = false;
		}
	}

	let displayedTrust = $derived(trust ?? host.hostKeyTrust);
	let status = $derived(displayedTrust?.status ?? 'unknown');
	let message = $derived(
		error ?? displayedTrust?.message ?? 'Host key trust has not been checked.'
	);
	let fingerprint = $derived(displayedTrust?.fingerprint ?? null);
</script>

<div
	class="mb-2 flex flex-col gap-2 rounded-md border bg-muted/20 p-2 text-xs md:flex-row md:items-center md:justify-between"
>
	<div class="flex min-w-0 items-start gap-2">
		{#if status === 'pinned'}
			<KeyRound class="mt-0.5 size-4 shrink-0 text-emerald-600" />
		{:else}
			<ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
		{/if}
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				<span class="font-medium">SSH host key</span>
				<Badge variant={status === 'pinned' ? 'secondary' : 'outline'}>{status}</Badge>
				{#if fingerprint}
					<span class="inline-flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
						<Fingerprint class="size-3" />{fingerprint}
					</span>
				{/if}
			</div>
			<p class="mt-0.5 text-muted-foreground">{message}</p>
		</div>
	</div>
	<div class="flex shrink-0 gap-2">
		<Button size="sm" variant="outline" disabled={busy} onclick={inspect}>Check</Button>
		<Button size="sm" disabled={busy || status === 'pinned'} onclick={enroll}>Enroll</Button>
	</div>
</div>
