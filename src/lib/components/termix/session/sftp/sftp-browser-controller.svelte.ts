import { browser } from '$app/environment';
import { onMount } from 'svelte';
import {
	assertRecursiveUploadItemsWithinLimits,
	createTransferProgress,
	dirname,
	fileTransferLimits,
	filterRemoteEntries,
	isDownloadableFile,
	joinPath,
	normalizePath,
	orderedRemoteEntriesForDelete,
	selectedEntries,
	selectionSummary,
	setVisibleSelection,
	toggleSelectedPath,
	uniqueRemoteEntries,
	updateTransferProgress,
	type RemoteEntry,
	type TransferProgress
} from './file-manager-state';
import {
	actionEntries,
	deleteEntriesForSelection,
	isAbortError,
	recursiveUploadLimitItems,
	uploadQueuePlan,
	type PendingRecursive
} from './sftp-browser-actions';
import {
	addBookmarkEntry,
	bookmarkStorageKey,
	parseBookmarks,
	removeBookmarkEntry,
	type BookmarkEntry
} from './sftp-bookmarks';
import { createSftpClient, type ApiBase } from './sftp-client';
import { formatModified, modeLabel, symlinkTarget } from './sftp-entry-format';
import { searchRemoteEntries } from './sftp-remote-search';
import { createSftpTextEditor } from './sftp-text-editor.svelte';
import {
	assertUploadItemsWithinLimits,
	runDeleteEntries,
	runDownloadFiles,
	runDownloadRecursive,
	runMoveEntries,
	runUploadItems
} from './sftp-transfer-operations';
import { droppedUploadItems, type UploadItem } from './sftp-upload-drop';

export type SftpBrowserControllerProps = {
	hostId: string;
	initialPath?: string;
	apiBase?: ApiBase;
	label?: string;
};

export function createSftpBrowserController({
	hostId,
	initialPath = '/',
	apiBase = 'sftp',
	label = 'SFTP'
}: SftpBrowserControllerProps) {
	let path = $state('/');
	let entries = $state<RemoteEntry[]>([]);
	let selected = $state<RemoteEntry | null>(null);
	let selectedPaths = $state<string[]>([]);
	let deleteDialogOpen = $state(false);
	let recursiveDialogOpen = $state(false);
	let pendingRecursive = $state<PendingRecursive | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let newFolderName = $state('');
	let renamePath = $state('');
	let searchQuery = $state('');
	let remoteSearchResults = $state<RemoteEntry[]>([]);
	let remoteSearching = $state(false);
	let bookmarks = $state<BookmarkEntry[]>([]);
	let bookmarksOpen = $state(true);
	let dragging = $state(false);
	let transfer = $state<TransferProgress | null>(null);
	let lastRetry = $state<(() => Promise<void>) | null>(null);
	let fileInput = $state<HTMLInputElement>();
	let activeAbort = $state<(() => void) | null>(null);
	let transferCancelled = false;
	let desktop = $state(browser ? window.matchMedia('(min-width: 1024px)').matches : false);
	let managerElement = $state<HTMLElement | null>(null);
	let wideLayout = $state(false);
	const client = createSftpClient(apiBase, hostId);
	const transferRuntime = {
		getCurrentPath: () => path,
		getTransfer: () => transfer,
		setTransfer: (nextTransfer: TransferProgress | null) => (transfer = nextTransfer),
		setActiveAbort: (abort: (() => void) | null) => (activeAbort = abort),
		markTransferCancelled: () => (transferCancelled = true),
		assertTransferActive,
		request,
		loadDirectory,
		listDirectory,
		client
	};
	const editor = createSftpTextEditor({
		client,
		request,
		getCurrentPath: () => path,
		loadDirectory,
		setLoading: (nextLoading) => (loading = nextLoading),
		setError: (message) => (error = message),
		setLastRetry: (retry) => (lastRetry = retry)
	});

	const visibleEntries = $derived(filterRemoteEntries(entries, searchQuery));
	const selectedEntryList = $derived(selectedEntries(entries, selectedPaths));
	const selection = $derived(selectionSummary(visibleEntries, selectedPaths));
	const activeSelectionEntries = $derived(
		selectedEntryList.length ? selectedEntryList : selected ? [selected] : []
	);
	const selectedDeleteEntries = $derived(orderedRemoteEntriesForDelete(activeSelectionEntries));
	const selectedDeleteDirectoryCount = $derived(
		selectedDeleteEntries.filter((entry) => entry.type === 'directory').length
	);
	const selectedTotalBytes = $derived(
		selectedEntryList.reduce((total, entry) => total + (entry.type === 'file' ? entry.size : 0), 0)
	);

	async function loadDirectory(nextPath = path) {
		loading = true;
		error = null;
		lastRetry = () => loadDirectory(nextPath);
		const controller = new AbortController();
		activeAbort = () => controller.abort();

		try {
			const result = await client.list(nextPath, controller.signal);
			path = result.path;
			entries = result.entries;
			selected = null;
			selectedPaths = [];
			renamePath = '';
			lastRetry = null;
		} catch (caught) {
			if (isAbortError(caught)) return;
			error = caught instanceof Error ? caught.message : 'Could not list directory';
		} finally {
			if (activeAbort) activeAbort = null;
			loading = false;
		}
	}

	async function listDirectory(remotePath: string): Promise<RemoteEntry[]> {
		return (await client.list(remotePath)).entries;
	}

	async function uploadFromPicker() {
		if (!fileInput) return;
		const files = Array.from(fileInput.files ?? []);
		fileInput.value = '';
		await queueUploads(files.map((file) => ({ file, relativePath: file.name, directories: [] })));
	}

	async function queueUploads(items: UploadItem[]) {
		const plan = uploadQueuePlan(items);
		if (plan.kind === 'empty') return;
		if (plan.kind === 'error') {
			error = plan.message;
			lastRetry = null;
			return;
		}
		if (plan.kind === 'recursive') {
			try {
				assertRecursiveUploadItemsWithinLimits(recursiveUploadLimitItems(plan.pending.items));
			} catch (caught) {
				error = caught instanceof Error ? caught.message : 'Recursive upload exceeds limits';
				lastRetry = null;
				return;
			}
			pendingRecursive = plan.pending;
			recursiveDialogOpen = true;
			return;
		}

		await uploadItems(plan.items);
	}

	async function uploadItems(items: UploadItem[]) {
		try {
			assertUploadItemsWithinLimits(items);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Recursive upload exceeds limits';
			lastRetry = null;
			return;
		}

		transferCancelled = false;
		error = null;
		lastRetry = () => uploadItems(items);
		const result = await runUploadItems(transferRuntime, items);
		if (result.error) error = result.error;
		if (!result.cancelled && !result.error) {
			lastRetry = null;
		}
	}

	async function createFolder() {
		if (!newFolderName.trim()) return;
		const created = await mutate(
			'/mkdir',
			{ path: joinPath(path, newFolderName.trim()) },
			'Could not create directory'
		);
		if (created) newFolderName = '';
	}

	async function renameSelected() {
		if (!selectedEntryList.length || !renamePath.trim()) return;
		const entriesToMove = actionEntries(selectedEntryList, selected);
		if (!entriesToMove.length) return;
		await moveEntries(entriesToMove, renamePath.trim());
	}

	async function moveEntries(entriesToMove: RemoteEntry[], target: string) {
		transferCancelled = false;
		error = null;
		lastRetry = () => moveEntries(entriesToMove, target);
		const result = await runMoveEntries(transferRuntime, entriesToMove, target);
		if (result.error) error = result.error;
		if (!result.cancelled && !result.error) {
			lastRetry = null;
		}
	}

	function requestDeleteSelected() {
		const selectedPathSnapshot = [...selectedPaths];
		const selectedSnapshot = selected;
		const entriesToDelete = deleteEntriesForSelection({
			entries,
			selectedPaths: selectedPathSnapshot,
			selected: selectedSnapshot
		});

		if (!entriesToDelete.length) return;
		if (!selectedPathSnapshot.length && selectedSnapshot) selectedPaths = [selectedSnapshot.path];
		deleteDialogOpen = true;
	}

	async function deleteSelected() {
		const entriesToDelete = selectedDeleteEntries;
		if (!entriesToDelete.length) return;
		transferCancelled = false;
		error = null;
		lastRetry = () => deleteSelected();
		const result = await runDeleteEntries(transferRuntime, entriesToDelete);
		if (result.error) error = result.error;
		if (!result.cancelled && !result.error) {
			deleteDialogOpen = false;
			selectedPaths = [];
			selected = null;
			lastRetry = null;
		}
	}

	async function downloadSelected() {
		const entriesToDownload = actionEntries(selectedEntryList, selected);
		if (!entriesToDownload.length) return;
		const directories = entriesToDownload.filter((entry) => entry.type === 'directory');
		const files = entriesToDownload.filter(isDownloadableFile);

		if (directories.length) {
			pendingRecursive = { kind: 'download', entries: entriesToDownload };
			recursiveDialogOpen = true;
			return;
		}

		await downloadFiles(uniqueRemoteEntries(files));
	}

	async function downloadRecursive(entriesToDownload: RemoteEntry[]) {
		const uniqueEntriesToDownload = actionEntries(entriesToDownload, null);
		transferCancelled = false;
		error = null;
		lastRetry = () => downloadRecursive(uniqueEntriesToDownload);
		const result = await runDownloadRecursive(transferRuntime, uniqueEntriesToDownload);
		if (result.error) error = result.error;
		if (!result.cancelled && !result.error) {
			lastRetry = null;
		}
	}

	async function downloadFiles(files: RemoteEntry[]) {
		const uniqueFiles = uniqueRemoteEntries(files);
		if (!uniqueFiles.length) return;
		transferCancelled = false;
		error = null;
		lastRetry = () => downloadFiles(uniqueFiles);
		const result = await runDownloadFiles(transferRuntime, uniqueFiles);
		if (result.error) error = result.error;
		if (!result.cancelled && !result.error) {
			lastRetry = null;
		}
	}

	async function mutate(route: string, body: Record<string, unknown>, fallback: string) {
		const succeeded = await request(
			route,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			},
			fallback
		);
		if (succeeded) await loadDirectory(path);
		return succeeded;
	}

	async function request(
		route: string,
		init: RequestInit,
		fallback: string,
		ignoreFailure = false
	) {
		loading = true;
		error = null;
		const controller = new AbortController();
		activeAbort = () => {
			transferCancelled = true;
			controller.abort();
		};
		try {
			return await client.request(route, init, fallback, controller.signal, ignoreFailure);
		} catch (caught) {
			if (isAbortError(caught)) throw caught;
			if (ignoreFailure) return false;
			error = caught instanceof Error ? caught.message : fallback;
			return false;
		} finally {
			activeAbort = null;
			loading = false;
		}
	}

	function selectEntry(entry: RemoteEntry) {
		selected = entry;
		selectedPaths = [entry.path];
		renamePath = entry.path;
	}

	function toggleEntry(entry: RemoteEntry, checked: boolean) {
		selectedPaths = toggleSelectedPath(selectedPaths, entry.path, checked);
		selected = checked
			? entry
			: (entries.find((candidate) => selectedPaths.includes(candidate.path)) ?? null);
		renamePath = selected?.path ?? '';
	}

	function toggleVisible(checked: boolean) {
		selectedPaths = setVisibleSelection(selectedPaths, visibleEntries, checked);
		selected = entries.find((entry) => selectedPaths.includes(entry.path)) ?? null;
		renamePath = selected?.path ?? '';
	}

	function activateEntry(entry: RemoteEntry) {
		selectEntry(entry);
		if (entry.type === 'directory') {
			void loadDirectory(entry.path);
			return;
		}
		if (entry.type === 'file') void editor.openText(entry);
	}

	function downloadUrl(entry: RemoteEntry) {
		return client.downloadUrl(entry);
	}

	function clearRemoteSearchResults() {
		remoteSearchResults = [];
	}

	async function runRemoteSearch() {
		const query = searchQuery.trim();
		if (!query) return;
		remoteSearching = true;
		error = null;
		lastRetry = () => runRemoteSearch();
		transferCancelled = false;
		transfer = createTransferProgress({
			kind: 'search',
			label: `Searching ${path}`,
			totalItems: fileTransferLimits.remoteSearchMaxEntries
		});

		try {
			const { matches, scannedEntries } = await searchRemoteEntries({
				rootPath: path,
				query,
				listDirectory,
				assertActive: assertTransferActive,
				onProgress: ({ directory, scannedEntries }) => {
					if (transfer) {
						transfer = updateTransferProgress(transfer, {
							completedItems: Math.min(scannedEntries, fileTransferLimits.remoteSearchMaxEntries),
							currentName: directory
						});
					}
				}
			});
			remoteSearchResults = matches;
			if (transfer) {
				transfer = updateTransferProgress(transfer, {
					label: `Found ${matches.length} result${matches.length === 1 ? '' : 's'}`,
					completedItems: scannedEntries,
					totalItems: scannedEntries,
					status: 'complete'
				});
			}
			lastRetry = null;
		} catch (caught) {
			if (isAbortError(caught)) {
				if (transfer) transfer = updateTransferProgress(transfer, { status: 'cancelled' });
				return;
			}
			error = caught instanceof Error ? caught.message : 'Could not search remote path';
			if (transfer) transfer = updateTransferProgress(transfer, { status: 'failed' });
		} finally {
			remoteSearching = false;
		}
	}

	async function openSearchResult(entry: RemoteEntry) {
		await loadDirectory(entry.type === 'directory' ? entry.path : dirname(entry.path));
		selected = entry;
		selectedPaths = [entry.path];
		renamePath = entry.path;
	}

	function addBookmark() {
		saveBookmarks(addBookmarkEntry(bookmarks, path));
	}

	function removeBookmark(id: string) {
		saveBookmarks(removeBookmarkEntry(bookmarks, id));
	}

	function saveBookmarks(next: BookmarkEntry[]) {
		bookmarks = next;
		localStorage.setItem(bookmarkStorageKey(apiBase, hostId), JSON.stringify(next));
	}

	function loadBookmarks() {
		bookmarks = parseBookmarks(localStorage.getItem(bookmarkStorageKey(apiBase, hostId)));
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		try {
			const items = await droppedUploadItems(event.dataTransfer);
			await queueUploads(items);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not prepare dropped upload';
			lastRetry = null;
		}
	}

	function confirmRecursiveAction() {
		const pending = pendingRecursive;
		recursiveDialogOpen = false;
		pendingRecursive = null;
		if (!pending) return;
		if (pending.kind === 'upload') {
			void uploadItems(pending.items);
			return;
		}
		void downloadRecursive(pending.entries);
	}

	function cancelActiveOperation() {
		transferCancelled = true;
		activeAbort?.();
		if (transfer?.status === 'running') {
			transfer = updateTransferProgress(transfer, { status: 'cancelled' });
		}
		loading = false;
		remoteSearching = false;
	}

	function assertTransferActive() {
		if (transferCancelled) throw new DOMException('Transfer cancelled', 'AbortError');
	}

	onMount(() => {
		const media = window.matchMedia('(min-width: 1024px)');
		const syncDesktop = () => (desktop = media.matches);
		const resizeObserver = new ResizeObserver((entries) => {
			wideLayout = (entries[0]?.contentRect.width ?? 0) >= 960;
		});
		syncDesktop();
		media.addEventListener('change', syncDesktop);
		if (managerElement) resizeObserver.observe(managerElement);
		path = normalizePath(initialPath);
		loadBookmarks();
		void loadDirectory(path);

		return () => {
			media.removeEventListener('change', syncDesktop);
			resizeObserver.disconnect();
		};
	});
	return {
		get hostId() {
			return hostId;
		},
		get initialPath() {
			return initialPath;
		},
		get apiBase() {
			return apiBase;
		},
		get label() {
			return label;
		},
		get path() {
			return path;
		},
		set path(value) {
			path = value;
		},
		get entries() {
			return entries;
		},
		get selected() {
			return selected;
		},
		set selected(value) {
			selected = value;
		},
		get selectedPaths() {
			return selectedPaths;
		},
		set selectedPaths(value) {
			selectedPaths = value;
		},
		get deleteDialogOpen() {
			return deleteDialogOpen;
		},
		set deleteDialogOpen(value) {
			deleteDialogOpen = value;
		},
		get recursiveDialogOpen() {
			return recursiveDialogOpen;
		},
		set recursiveDialogOpen(value) {
			recursiveDialogOpen = value;
		},
		get pendingRecursive() {
			return pendingRecursive;
		},
		set pendingRecursive(value) {
			pendingRecursive = value;
		},
		get loading() {
			return loading;
		},
		set loading(value) {
			loading = value;
		},
		get error() {
			return error;
		},
		set error(value) {
			error = value;
		},
		get newFolderName() {
			return newFolderName;
		},
		set newFolderName(value) {
			newFolderName = value;
		},
		get renamePath() {
			return renamePath;
		},
		set renamePath(value) {
			renamePath = value;
		},
		get searchQuery() {
			return searchQuery;
		},
		set searchQuery(value) {
			searchQuery = value;
		},
		get remoteSearchResults() {
			return remoteSearchResults;
		},
		set remoteSearchResults(value) {
			remoteSearchResults = value;
		},
		get remoteSearching() {
			return remoteSearching;
		},
		set remoteSearching(value) {
			remoteSearching = value;
		},
		get bookmarks() {
			return bookmarks;
		},
		set bookmarks(value) {
			bookmarks = value;
		},
		get bookmarksOpen() {
			return bookmarksOpen;
		},
		set bookmarksOpen(value) {
			bookmarksOpen = value;
		},
		get textPath() {
			return editor.textPath;
		},
		set textPath(value) {
			editor.textPath = value;
		},
		get textValue() {
			return editor.textValue;
		},
		set textValue(value) {
			editor.textValue = value;
		},
		get textDirty() {
			return editor.textDirty;
		},
		set textDirty(value) {
			editor.textDirty = value;
		},
		get dragging() {
			return dragging;
		},
		set dragging(value) {
			dragging = value;
		},
		get transfer() {
			return transfer;
		},
		set transfer(value) {
			transfer = value;
		},
		get lastRetry() {
			return lastRetry;
		},
		set lastRetry(value) {
			lastRetry = value;
		},
		get fileInput() {
			return fileInput;
		},
		set fileInput(value) {
			fileInput = value;
		},
		get activeAbort() {
			return activeAbort;
		},
		set activeAbort(value) {
			activeAbort = value;
		},
		get desktop() {
			return desktop;
		},
		set desktop(value) {
			desktop = value;
		},
		get managerElement() {
			return managerElement;
		},
		set managerElement(value) {
			managerElement = value;
		},
		get wideLayout() {
			return wideLayout;
		},
		set wideLayout(value) {
			wideLayout = value;
		},
		get visibleEntries() {
			return visibleEntries;
		},
		get selectedEntryList() {
			return selectedEntryList;
		},
		get selection() {
			return selection;
		},
		get selectedDeleteEntries() {
			return selectedDeleteEntries;
		},
		get selectedDeleteDirectoryCount() {
			return selectedDeleteDirectoryCount;
		},
		get selectedTotalBytes() {
			return selectedTotalBytes;
		},
		get loadDirectory() {
			return loadDirectory;
		},
		get removeBookmark() {
			return removeBookmark;
		},
		get openSearchResult() {
			return openSearchResult;
		},
		get toggleVisible() {
			return toggleVisible;
		},
		get toggleEntry() {
			return toggleEntry;
		},
		get selectEntry() {
			return selectEntry;
		},
		get activateEntry() {
			return activateEntry;
		},
		get symlinkTarget() {
			return symlinkTarget;
		},
		get modeLabel() {
			return modeLabel;
		},
		get formatModified() {
			return formatModified;
		},
		get downloadUrl() {
			return downloadUrl;
		},
		get saveText() {
			return editor.saveText;
		},
		get handleDrop() {
			return handleDrop;
		},
		get addBookmark() {
			return addBookmark;
		},
		get uploadFromPicker() {
			return uploadFromPicker;
		},
		get cancelActiveOperation() {
			return cancelActiveOperation;
		},
		get runRemoteSearch() {
			return runRemoteSearch;
		},
		get clearRemoteSearchResults() {
			return clearRemoteSearchResults;
		},
		get createFolder() {
			return createFolder;
		},
		get renameSelected() {
			return renameSelected;
		},
		get openText() {
			return (entry = selected) => editor.openText(entry);
		},
		get downloadSelected() {
			return downloadSelected;
		},
		get requestDeleteSelected() {
			return requestDeleteSelected;
		},
		get deleteSelected() {
			return deleteSelected;
		},
		get confirmRecursiveAction() {
			return confirmRecursiveAction;
		}
	};
}
