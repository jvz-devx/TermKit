<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import type { HostSummary } from '$lib/remotes/hosts.remote';

	let {
		open = $bindable(false),
		host,
		deleting = false,
		onConfirm
	}: {
		open?: boolean;
		host: HostSummary | null;
		deleting?: boolean;
		onConfirm?: () => void | Promise<void>;
	} = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete host?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if host}
					This removes {host.name} from the connection inventory. Existing sessions are not recovered
					from this action.
				{:else}
					This host will be removed from the connection inventory.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={!host || deleting}
				onclick={(event) => {
					event.preventDefault();
					void onConfirm?.();
				}}
			>
				{deleting ? 'Deleting...' : 'Delete host'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
