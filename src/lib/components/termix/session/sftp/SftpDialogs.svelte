<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { fileTransferLimits, formatSize, type RemoteEntry } from '../file-manager-state';

	type UploadItem = {
		file: globalThis.File;
		relativePath: string;
		directories: string[];
	};

	type PendingRecursive =
		| { kind: 'upload'; items: UploadItem[]; directoryCount: number; totalBytes: number }
		| { kind: 'download'; entries: RemoteEntry[] };

	let {
		deleteDialogOpen = $bindable(false),
		recursiveDialogOpen = $bindable(false),
		loading,
		selectedDeleteEntries,
		selectedDeleteDirectoryCount,
		pendingRecursive,
		deleteSelected,
		confirmRecursiveAction
	}: {
		deleteDialogOpen: boolean;
		recursiveDialogOpen: boolean;
		loading: boolean;
		selectedDeleteEntries: RemoteEntry[];
		selectedDeleteDirectoryCount: number;
		pendingRecursive: PendingRecursive | null;
		deleteSelected: () => void | Promise<void>;
		confirmRecursiveAction: () => void;
	} = $props();
</script>

<AlertDialog.Root bind:open={deleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete remote paths?</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently deletes {selectedDeleteEntries.length} selected path{selectedDeleteEntries.length ===
				1
					? ''
					: 's'} from the remote host.
				{#if selectedDeleteDirectoryCount}
					Directory removal uses the remote server empty-directory operation; non-empty directories
					may fail.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={loading}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				disabled={loading}
				onclick={(event) => {
					event.preventDefault();
					void deleteSelected();
				}}
			>
				{loading ? 'Deleting...' : 'Delete selected'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={recursiveDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{pendingRecursive?.kind === 'upload'
					? 'Upload folder contents?'
					: 'Download folder contents?'}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingRecursive?.kind === 'upload'}
					This will create up to {pendingRecursive.directoryCount} remote folder{pendingRecursive.directoryCount ===
					1
						? ''
						: 's'} and upload {pendingRecursive.items.length} file{pendingRecursive.items.length ===
					1
						? ''
						: 's'} ({formatSize(pendingRecursive.totalBytes)}). Per-file uploads are limited to {formatSize(
						fileTransferLimits.uploadMaxBytes
					)}; recursive uploads are capped at {fileTransferLimits.recursiveMaxFiles} files, {fileTransferLimits.recursiveMaxEntries}
					scanned entries, and {formatSize(fileTransferLimits.recursiveMaxBytes)} total.
				{:else}
					This will walk selected folders and start individual file downloads. Recursive downloads
					are capped at {fileTransferLimits.recursiveMaxFiles} files and {fileTransferLimits.recursiveMaxEntries}
					scanned entries.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={(event) => {
					event.preventDefault();
					confirmRecursiveAction();
				}}
			>
				Continue
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
