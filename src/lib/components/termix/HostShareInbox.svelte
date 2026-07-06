<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		acceptHostShare,
		declineHostShare,
		listHosts,
		watchPendingHostShares,
		type HostShareInvitationSummary
	} from '$lib/remotes/hosts.remote';
	import { listCredentials } from '$lib/remotes/credentials.remote';

	const sharesQuery = watchPendingHostShares();
	const shares = $derived(sharesQuery.current ?? []);
	let open = $state(false);
	let selectedId = $state<string | null>(null);
	let busyId = $state<string | null>(null);
	let error = $state<string | null>(null);
	const selected = $derived(shares.find((share) => share.id === selectedId) ?? shares[0] ?? null);

	$effect(() => {
		if (!shares.length) {
			open = false;
			selectedId = null;
			return;
		}
		if (!selectedId || !shares.some((share) => share.id === selectedId)) {
			selectedId = shares[0].id;
		}
	});

	async function accept(share: HostShareInvitationSummary) {
		busyId = share.id;
		error = null;
		try {
			await acceptHostShare(share.id).updates(listHosts, listCredentials);
			await sharesQuery.reconnect();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not accept share';
		} finally {
			busyId = null;
		}
	}

	async function decline(share: HostShareInvitationSummary) {
		busyId = share.id;
		error = null;
		try {
			await declineHostShare(share.id);
			await sharesQuery.reconnect();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not refuse share';
		} finally {
			busyId = null;
		}
	}
</script>

{#if shares.length}
	<div class="pointer-events-none fixed top-16 right-4">
		<Button class="pointer-events-auto shadow-lg" variant="secondary" onclick={() => (open = true)}>
			<Share2Icon data-icon="inline-start" />
			{shares.length === 1 ? 'Host shared with you' : `${shares.length} host shares`}
		</Button>
	</div>
{/if}

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Host share</Dialog.Title>
			<Dialog.Description
				>Review the shared host before adding it to your inventory.</Dialog.Description
			>
		</Dialog.Header>

		{#if selected}
			<div class="flex flex-col gap-4">
				{#if shares.length > 1}
					<div class="flex flex-wrap gap-2">
						{#each shares as share (share.id)}
							<Button
								type="button"
								size="sm"
								variant={share.id === selected.id ? 'secondary' : 'outline'}
								onclick={() => (selectedId = share.id)}
							>
								{share.host.name}
							</Button>
						{/each}
					</div>
				{/if}

				<div class="rounded-md border p-3">
					<div class="flex items-start justify-between gap-3">
						<div>
							<div class="font-medium">{selected.host.name}</div>
							<div class="font-mono text-xs text-muted-foreground">
								{selected.host.username ? `${selected.host.username}@` : ''}{selected.host
									.hostname}:{selected.host.port}
							</div>
						</div>
						<Badge variant="outline">{selected.host.protocol.toUpperCase()}</Badge>
					</div>
					<div class="mt-3 grid gap-2 text-sm">
						<div class="flex justify-between gap-3">
							<span class="text-muted-foreground">Folder</span>
							<span>{selected.host.folder ?? 'None'}</span>
						</div>
						<div class="flex justify-between gap-3">
							<span class="text-muted-foreground">Credentials</span>
							<span>
								{selected.includeCredentials
									? (selected.credentialName ?? 'Included')
									: 'Not included'}
							</span>
						</div>
						{#if selected.host.tags.length}
							<div class="flex flex-wrap gap-1">
								{#each selected.host.tags as tag (tag)}
									<Badge variant="secondary">{tag}</Badge>
								{/each}
							</div>
						{/if}
						{#if selected.host.notes}
							<p class="text-muted-foreground">{selected.host.notes}</p>
						{/if}
					</div>
				</div>

				{#if error}
					<p class="text-sm text-destructive">{error}</p>
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			{#if selected}
				<Button
					type="button"
					variant="outline"
					disabled={busyId === selected.id}
					onclick={() => decline(selected)}
				>
					<XIcon data-icon="inline-start" />
					Refuse
				</Button>
				<Button type="button" disabled={busyId === selected.id} onclick={() => accept(selected)}>
					<CheckIcon data-icon="inline-start" />
					Accept
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
