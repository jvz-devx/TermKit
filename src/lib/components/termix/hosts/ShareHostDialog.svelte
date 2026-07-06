<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { shareHost, type HostSummary } from '$lib/remotes/hosts.remote';

	let {
		open = $bindable(false),
		host,
		onShared,
		onError
	}: {
		open?: boolean;
		host: HostSummary | null;
		onShared?: () => void;
		onError?: (message: string) => void;
	} = $props();

	let activeHostId = $state<string | null>(null);
	let recipients = $state('');
	let includeCredentials = $state(false);
	let sharing = $state(false);

	$effect(() => {
		if (!open) {
			activeHostId = null;
			return;
		}
		if (host?.id === activeHostId) return;
		activeHostId = host?.id ?? null;
		recipients = '';
		includeCredentials = Boolean(host?.credentialId);
	});

	async function submit() {
		if (!host) return;
		sharing = true;
		try {
			await shareHost({
				hostId: host.id,
				recipients,
				includeCredentials
			});
			open = false;
			onShared?.();
		} catch (caught) {
			onError?.(caught instanceof Error ? caught.message : 'Could not share host');
		} finally {
			sharing = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Share host</Dialog.Title>
			<Dialog.Description>
				The recipient gets a request and chooses whether to add a copy.
			</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={(event) => (event.preventDefault(), submit())}>
			<div class="flex flex-col gap-2">
				<Label for="host-share-recipients">Users or Microsoft emails</Label>
				<Textarea
					id="host-share-recipients"
					placeholder="jane@example.com, operator"
					bind:value={recipients}
					required
				/>
			</div>
			<div class="flex items-center justify-between gap-3 rounded-md border p-3">
				<div>
					<Label for="host-share-credentials">Include credentials</Label>
					<p class="text-xs text-muted-foreground">
						{host?.credentialName ?? 'This host has no saved credential'}
					</p>
				</div>
				<Switch
					id="host-share-credentials"
					bind:checked={includeCredentials}
					disabled={!host?.credentialId}
				/>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={sharing || !host}>
					{sharing ? 'Sharing...' : 'Share'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
