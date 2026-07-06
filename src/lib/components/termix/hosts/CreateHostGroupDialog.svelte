<script lang="ts">
	import { FolderPlus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { createHostGroup, listHostGroups } from '$lib/remotes/host-groups.remote';

	let {
		onSaved,
		onError
	}: {
		onSaved?: () => void | Promise<void>;
		onError?: (message: string) => void;
	} = $props();

	let open = $state(false);
	let name = $state('');
	let saving = $state(false);

	async function submit() {
		saving = true;
		try {
			await createHostGroup({ name }).updates(listHostGroups);
			name = '';
			open = false;
			await onSaved?.();
		} catch (caught) {
			onError?.(caught instanceof Error ? caught.message : 'Could not save group');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Button size="sm" variant="outline" onclick={() => (open = true)}>
		<FolderPlus data-icon="inline-start" />
		Group
	</Button>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create group</Dialog.Title>
			<Dialog.Description>Groups organize hosts without changing access.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={(event) => (event.preventDefault(), submit())}>
			<div class="flex flex-col gap-2">
				<Label for="host-group-name">Name</Label>
				<Input id="host-group-name" bind:value={name} required />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={saving}>
					{saving ? 'Saving...' : 'Create group'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
