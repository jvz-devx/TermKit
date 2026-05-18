<script lang="ts">
	import * as Resizable from '$lib/components/ui/resizable';
	import SftpBookmarksPane from './components/SftpBookmarksPane.svelte';
	import SftpDialogs from './components/SftpDialogs.svelte';
	import SftpEditorPane from './components/SftpEditorPane.svelte';
	import SftpFileListPane from './components/SftpFileListPane.svelte';
	import SftpToolbar from './components/SftpToolbar.svelte';
	import { createSftpBrowserController } from './controller/sftp-browser-controller.svelte';

	let {
		hostId,
		initialPath,
		apiBase,
		label
	}: {
		hostId: string;
		initialPath?: string;
		apiBase?: 'sftp' | 'ftp';
		label?: string;
	} = $props();

	// eslint-disable-next-line svelte/no-unused-svelte-ignore
	// svelte-ignore state_referenced_locally -- connection identity is fixed for this mounted browser
	const controller = createSftpBrowserController({ hostId, initialPath, apiBase, label });
</script>

{#snippet resizeHandle(
	handleLabel = `Resize ${controller.label.toLowerCase()} file-manager pane boundary`
)}
	<Resizable.Handle
		withHandle
		tabindex={0}
		aria-label={handleLabel}
		class="bg-transparent hover:bg-muted/60 focus-visible:ring-2 data-[direction=horizontal]:mx-1 data-[direction=horizontal]:w-2 data-[direction=horizontal]:after:w-2 data-[direction=vertical]:my-1 data-[direction=vertical]:h-2 data-[direction=vertical]:after:h-2"
	/>
{/snippet}

<div
	bind:this={controller.managerElement}
	class={`grid h-full min-h-0 min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-md border transition-colors ${controller.dragging ? 'border-primary bg-primary/5' : ''}`}
	role="region"
	aria-label={`${controller.label} file manager`}
	ondragover={(event) => {
		event.preventDefault();
		controller.dragging = true;
	}}
	ondragleave={() => (controller.dragging = false)}
	ondrop={controller.handleDrop}
>
	<SftpToolbar
		bind:path={controller.path}
		bind:searchQuery={controller.searchQuery}
		bind:newFolderName={controller.newFolderName}
		bind:renamePath={controller.renamePath}
		bind:fileInput={controller.fileInput}
		selected={controller.selected}
		selectedPaths={controller.selectedPaths}
		selectedEntryList={controller.selectedEntryList}
		selectionCount={controller.selection.count}
		selectedTotalBytes={controller.selectedTotalBytes}
		activeAbort={controller.activeAbort}
		transfer={controller.transfer}
		remoteSearching={controller.remoteSearching}
		error={controller.error}
		loadDirectory={controller.loadDirectory}
		addBookmark={controller.addBookmark}
		uploadFromPicker={controller.uploadFromPicker}
		cancelActiveOperation={controller.cancelActiveOperation}
		lastRetry={controller.lastRetry}
		runRemoteSearch={controller.runRemoteSearch}
		createFolder={controller.createFolder}
		renameSelected={controller.renameSelected}
		openText={controller.openText}
		downloadSelected={controller.downloadSelected}
		requestDeleteSelected={controller.requestDeleteSelected}
		clearRemoteSearchResults={controller.clearRemoteSearchResults}
	/>

	<Resizable.PaneGroup
		direction={controller.desktop && controller.wideLayout ? 'horizontal' : 'vertical'}
		keyboardResizeBy={5}
		autoSaveId={`termkit-file-manager:${controller.apiBase}:${controller.hostId}:${controller.desktop && controller.wideLayout ? 'wide' : 'stacked'}`}
		class="min-h-0 min-w-0"
	>
		<Resizable.Pane
			defaultSize={controller.desktop && controller.wideLayout
				? controller.bookmarksOpen
					? 18
					: 7
				: 18}
			minSize={controller.desktop && controller.wideLayout ? 6 : 10}
		>
			<SftpBookmarksPane
				path={controller.path}
				bookmarks={controller.bookmarks}
				bind:bookmarksOpen={controller.bookmarksOpen}
				remoteSearchResults={controller.remoteSearchResults}
				loadDirectory={controller.loadDirectory}
				removeBookmark={controller.removeBookmark}
				openSearchResult={controller.openSearchResult}
			/>
		</Resizable.Pane>
		{@render resizeHandle()}
		<Resizable.Pane
			defaultSize={controller.desktop && controller.wideLayout ? 56 : 56}
			minSize={controller.desktop && controller.wideLayout ? 34 : 32}
		>
			<SftpFileListPane
				path={controller.path}
				label={controller.label}
				entries={controller.visibleEntries}
				selected={controller.selected}
				selectedPaths={controller.selectedPaths}
				selection={controller.selection}
				searchQuery={controller.searchQuery}
				dragging={controller.dragging}
				loading={controller.loading}
				error={controller.error}
				toggleVisible={controller.toggleVisible}
				toggleEntry={controller.toggleEntry}
				selectEntry={controller.selectEntry}
				activateEntry={controller.activateEntry}
				symlinkTarget={controller.symlinkTarget}
				modeLabel={controller.modeLabel}
				formatModified={controller.formatModified}
				downloadUrl={controller.downloadUrl}
			/>
		</Resizable.Pane>
		{@render resizeHandle()}
		<Resizable.Pane
			defaultSize={controller.desktop && controller.wideLayout ? 26 : 26}
			minSize={controller.desktop && controller.wideLayout ? 18 : 16}
		>
			<SftpEditorPane
				bind:textValue={controller.textValue}
				bind:textDirty={controller.textDirty}
				textPath={controller.textPath}
				saveText={controller.saveText}
			/>
		</Resizable.Pane>
	</Resizable.PaneGroup>

	<SftpDialogs
		bind:deleteDialogOpen={controller.deleteDialogOpen}
		bind:recursiveDialogOpen={controller.recursiveDialogOpen}
		loading={controller.loading}
		selectedDeleteEntries={controller.selectedDeleteEntries}
		selectedDeleteDirectoryCount={controller.selectedDeleteDirectoryCount}
		pendingRecursive={controller.pendingRecursive}
		deleteSelected={controller.deleteSelected}
		confirmRecursiveAction={controller.confirmRecursiveAction}
	/>
</div>
