<script lang="ts">
	import {
		Ban,
		BookmarkPlus,
		Download,
		File as FileIcon,
		FolderDown,
		FolderPlus,
		MoveRight,
		Pencil,
		RefreshCw,
		RotateCcw,
		Search,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import {
		formatSize,
		parentPath,
		type RemoteEntry,
		type TransferProgress
	} from '../file-manager-state';
	import SftpTransferProgress from './SftpTransferProgress.svelte';

	let {
		path = $bindable(''),
		searchQuery = $bindable(''),
		newFolderName = $bindable(''),
		renamePath = $bindable(''),
		fileInput = $bindable<HTMLInputElement | undefined>(),
		selected,
		selectedPaths,
		selectedEntryList,
		selectionCount,
		selectedTotalBytes,
		activeAbort,
		transfer,
		remoteSearching,
		error,
		loadDirectory,
		addBookmark,
		uploadFromPicker,
		cancelActiveOperation,
		lastRetry,
		runRemoteSearch,
		clearRemoteSearchResults,
		createFolder,
		renameSelected,
		openText,
		downloadSelected,
		requestDeleteSelected
	}: {
		path: string;
		searchQuery: string;
		newFolderName: string;
		renamePath: string;
		fileInput: HTMLInputElement | undefined;
		selected: RemoteEntry | null;
		selectedPaths: string[];
		selectedEntryList: RemoteEntry[];
		selectionCount: number;
		selectedTotalBytes: number;
		activeAbort: (() => void) | null;
		transfer: TransferProgress | null;
		remoteSearching: boolean;
		error: string | null;
		loadDirectory: (nextPath?: string) => void | Promise<void>;
		addBookmark: () => void;
		uploadFromPicker: (event: Event) => void | Promise<void>;
		cancelActiveOperation: () => void;
		lastRetry: (() => void | Promise<void>) | null;
		runRemoteSearch: () => void | Promise<void>;
		clearRemoteSearchResults: () => void;
		createFolder: () => void | Promise<void>;
		renameSelected: () => void | Promise<void>;
		openText: () => void | Promise<void>;
		downloadSelected: () => void | Promise<void>;
		requestDeleteSelected: () => void;
	} = $props();
</script>

<div class="space-y-2 border-b bg-muted/20 p-2">
	<div class="flex flex-wrap items-center gap-2">
		<Input
			aria-label="Remote path"
			class="h-8 min-w-48 flex-1 font-mono text-xs"
			bind:value={path}
			onkeydown={(event) => event.key === 'Enter' && loadDirectory()}
		/>
		<Button
			size="icon-sm"
			variant="outline"
			aria-label="Parent directory"
			onclick={() => loadDirectory(parentPath(path))}
		>
			<FolderDown class="size-4" />
		</Button>
		<Button size="icon-sm" variant="outline" aria-label="Refresh" onclick={() => loadDirectory()}>
			<RefreshCw class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			variant="outline"
			aria-label="Bookmark current path"
			onclick={addBookmark}
		>
			<BookmarkPlus class="size-4" />
		</Button>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			class="sr-only"
			aria-label="Upload files"
			onchange={uploadFromPicker}
		/>
		<Button size="sm" variant="outline" onclick={() => fileInput?.click()}>
			<Upload class="size-4" />Upload
		</Button>
		{#if activeAbort || transfer?.status === 'running' || remoteSearching}
			<Button size="sm" variant="destructive" onclick={cancelActiveOperation}>
				<Ban class="size-4" />Cancel
			</Button>
		{/if}
		{#if lastRetry && error}
			<Button size="sm" variant="secondary" onclick={() => lastRetry?.()}>
				<RotateCcw class="size-4" />Retry
			</Button>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<Input
			aria-label="Remote search"
			class="h-8 min-w-48 flex-1"
			placeholder="Filter current directory or search remote tree"
			bind:value={searchQuery}
			onkeydown={(event) => event.key === 'Enter' && runRemoteSearch()}
		/>
		<Button
			size="sm"
			variant="outline"
			disabled={!searchQuery.trim() || remoteSearching}
			onclick={runRemoteSearch}
		>
			<Search class="size-4" />Tree search
		</Button>
		{#if searchQuery}
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label="Clear search"
				onclick={() => {
					searchQuery = '';
					clearRemoteSearchResults();
				}}
			>
				<X class="size-4" />
			</Button>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<Input
			aria-label="New folder name"
			class="h-8 w-40"
			placeholder="folder"
			bind:value={newFolderName}
			onkeydown={(event) => event.key === 'Enter' && createFolder()}
		/>
		<Button size="icon-sm" variant="outline" aria-label="Create folder" onclick={createFolder}>
			<FolderPlus class="size-4" />
		</Button>
		<Input
			aria-label="Rename or move target path"
			class="h-8 min-w-48 flex-1 font-mono text-xs"
			placeholder={selectedPaths.length > 1
				? 'target directory for selected items'
				: 'select an entry to rename or move'}
			bind:value={renamePath}
			disabled={!selectedEntryList.length && !selected}
		/>
		<Button
			size="icon-sm"
			variant="outline"
			aria-label={selectedPaths.length > 1 ? 'Move selected paths' : 'Rename or move selected path'}
			disabled={(!selectedEntryList.length && !selected) || !renamePath.trim()}
			onclick={renameSelected}
		>
			{#if selectedPaths.length > 1}
				<MoveRight class="size-4" />
			{:else}
				<Pencil class="size-4" />
			{/if}
		</Button>
		<Button
			size="icon-sm"
			variant="outline"
			aria-label="Open selected text file"
			disabled={!selected || selected.type !== 'file'}
			onclick={() => openText()}
		>
			<FileIcon class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			variant="outline"
			aria-label="Download selected paths"
			disabled={!selectedEntryList.length && !selected}
			onclick={downloadSelected}
		>
			<Download class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			variant="destructive"
			aria-label="Delete selected paths"
			disabled={!selectedEntryList.length && !selected}
			onclick={requestDeleteSelected}
		>
			<Trash2 class="size-4" />
		</Button>
		{#if selectionCount}
			<Badge variant="secondary">{selectionCount} selected</Badge>
			<Badge variant="outline">{formatSize(selectedTotalBytes)}</Badge>
		{/if}
	</div>

	{#if transfer}
		<SftpTransferProgress {transfer} />
	{/if}
</div>
