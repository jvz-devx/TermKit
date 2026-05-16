/* eslint-disable svelte/prefer-svelte-reactivity */
import { browser } from '$app/environment';
import { onMount } from 'svelte';
import {
	assertRecursiveUploadItemsWithinLimits,
	basename,
	countRecursiveUploadEntry,
	countRecursiveUploadFile,
	createTransferProgress,
	createRecursiveUploadLimitState,
	dirname,
	fileTransferLimits,
	filterRemoteEntries,
	formatSize,
	isDownloadableFile,
	joinPath,
	minimalRemoteEntries,
	normalizePath,
	normalizeTarget,
	orderedRemoteEntriesForDelete,
	selectedEntries,
	selectionSummary,
	setVisibleSelection,
	toggleSelectedPath,
	uniqueRemoteEntries,
	updateTransferProgress,
	type RemoteEntry,
	type RecursiveUploadLimitState,
	type TransferProgress
} from '../file-manager-state';

type ApiBase = 'sftp' | 'ftp';
type ApiResponseBody = Record<string, unknown>;

type BookmarkEntry = {
	id: string;
	path: string;
	label: string;
	createdAt: string;
};

type UploadItem = {
	file: globalThis.File;
	relativePath: string;
	directories: string[];
};

type PendingRecursive =
	| {
			kind: 'upload';
			items: UploadItem[];
			directoryCount: number;
			totalBytes: number;
	  }
	| {
			kind: 'download';
			entries: RemoteEntry[];
	  };

type WebKitFileSystemEntry = {
	name: string;
	fullPath: string;
	isFile: boolean;
	isDirectory: boolean;
};

type WebKitFileSystemFileEntry = WebKitFileSystemEntry & {
	file: (success: (file: globalThis.File) => void, failure: (error: DOMException) => void) => void;
};

type WebKitFileSystemDirectoryEntry = WebKitFileSystemEntry & {
	createReader: () => {
		readEntries: (
			success: (entries: WebKitFileSystemEntry[]) => void,
			failure: (error: DOMException) => void
		) => void;
	};
};

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
	let textPath = $state<string | null>(null);
	let textValue = $state('');
	let textDirty = $state(false);
	let dragging = $state(false);
	let transfer = $state<TransferProgress | null>(null);
	let lastRetry = $state<(() => Promise<void>) | null>(null);
	let fileInput = $state<HTMLInputElement>();
	let activeAbort = $state<(() => void) | null>(null);
	let transferCancelled = false;
	let desktop = $state(browser ? window.matchMedia('(min-width: 1024px)').matches : false);
	let managerElement = $state<HTMLElement | null>(null);
	let wideLayout = $state(false);

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

	function apiUrl(route: string) {
		return `/api/${apiBase}/${encodeURIComponent(hostId)}${route}`;
	}

	async function loadDirectory(nextPath = path) {
		loading = true;
		error = null;
		lastRetry = () => loadDirectory(nextPath);
		const controller = new AbortController();
		activeAbort = () => controller.abort();

		try {
			const response = await fetch(
				apiUrl(`/list?path=${encodeURIComponent(normalizePath(nextPath))}`),
				{ signal: controller.signal }
			);
			const body = await readApiBody(response, 'Could not list directory');
			if (!response.ok) throw new Error(apiErrorMessage(body, 'Could not list directory'));
			path = typeof body.path === 'string' ? body.path : normalizePath(nextPath);
			entries = Array.isArray(body.entries) ? (body.entries as RemoteEntry[]) : [];
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
		const response = await fetch(
			apiUrl(`/list?path=${encodeURIComponent(normalizePath(remotePath))}`)
		);
		const body = await readApiBody(response, 'Could not list directory');
		if (!response.ok) throw new Error(apiErrorMessage(body, 'Could not list directory'));
		return Array.isArray(body.entries) ? (body.entries as RemoteEntry[]) : [];
	}

	async function uploadFromPicker() {
		if (!fileInput) return;
		const files = Array.from(fileInput.files ?? []);
		fileInput.value = '';
		await queueUploads(files.map((file) => ({ file, relativePath: file.name, directories: [] })));
	}

	async function queueUploads(items: UploadItem[]) {
		if (!items.length) return;
		const oversized = items.find((item) => item.file.size > fileTransferLimits.uploadMaxBytes);
		if (oversized) {
			error = `${oversized.relativePath} exceeds the ${formatSize(fileTransferLimits.uploadMaxBytes)} upload limit`;
			lastRetry = null;
			return;
		}

		const totalBytes = items.reduce((total, item) => total + item.file.size, 0);
		const directories = new Set(items.flatMap((item) => item.directories));
		const hasRecursivePayload = directories.size > 0;
		if (hasRecursivePayload) {
			try {
				assertRecursiveUploadItemsWithinLimits(
					items.map((item) => ({
						size: item.file.size,
						directories: item.directories
					}))
				);
			} catch (caught) {
				error = caught instanceof Error ? caught.message : 'Recursive upload exceeds limits';
				lastRetry = null;
				return;
			}
			pendingRecursive = {
				kind: 'upload',
				items,
				directoryCount: directories.size,
				totalBytes
			};
			recursiveDialogOpen = true;
			return;
		}

		await uploadItems(items);
	}

	async function uploadItems(items: UploadItem[]) {
		const hasRecursivePayload = items.some((item) => item.directories.length > 0);
		if (hasRecursivePayload) {
			try {
				assertRecursiveUploadItemsWithinLimits(
					items.map((item) => ({
						size: item.file.size,
						directories: item.directories
					}))
				);
			} catch (caught) {
				error = caught instanceof Error ? caught.message : 'Recursive upload exceeds limits';
				lastRetry = null;
				return;
			}
		}

		transferCancelled = false;
		error = null;
		lastRetry = () => uploadItems(items);
		const totalBytes = items.reduce((total, item) => total + item.file.size, 0);
		let completedBytes = 0;
		let completedItems = 0;
		transfer = createTransferProgress({
			kind: 'upload',
			label: `Uploading ${items.length} item${items.length === 1 ? '' : 's'}`,
			totalBytes,
			totalItems: items.length
		});

		try {
			await ensureUploadDirectories(items);
			for (const item of items) {
				assertTransferActive();
				transfer = updateTransferProgress(transfer, {
					currentName: item.relativePath,
					completedBytes,
					completedItems
				});
				await uploadOne(item, (loaded) => {
					if (!transfer) return;
					transfer = updateTransferProgress(transfer, {
						completedBytes: completedBytes + loaded,
						completedItems,
						currentName: item.relativePath
					});
				});
				completedBytes += item.file.size;
				completedItems += 1;
				transfer = updateTransferProgress(transfer, {
					completedBytes,
					completedItems,
					currentName: item.relativePath
				});
			}
			if (transfer) transfer = updateTransferProgress(transfer, { status: 'complete' });
			lastRetry = null;
			await loadDirectory(path);
		} catch (caught) {
			if (isAbortError(caught)) {
				if (transfer) transfer = updateTransferProgress(transfer, { status: 'cancelled' });
				return;
			}
			error = caught instanceof Error ? caught.message : 'Could not upload file';
			if (transfer) transfer = updateTransferProgress(transfer, { status: 'failed' });
		} finally {
			activeAbort = null;
		}
	}

	async function ensureUploadDirectories(items: UploadItem[]) {
		const directories = [...new Set(items.flatMap((item) => item.directories))].sort(
			(left, right) => left.split('/').length - right.split('/').length
		);

		for (const directory of directories) {
			assertTransferActive();
			await request(
				'/mkdir',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ path: joinPath(path, directory) })
				},
				'Could not create upload directory',
				true
			).catch(() => null);
		}
	}

	function uploadOne(item: UploadItem, onProgress: (loaded: number) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			const remotePath = joinPath(path, item.relativePath);
			activeAbort = () => {
				transferCancelled = true;
				xhr.abort();
			};

			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable) onProgress(event.loaded);
			};
			xhr.onload = () => {
				activeAbort = null;
				if (xhr.status >= 200 && xhr.status < 300) {
					onProgress(item.file.size);
					resolve();
					return;
				}
				reject(new Error(responseError(xhr.responseText, 'Could not upload file')));
			};
			xhr.onerror = () => {
				activeAbort = null;
				reject(new Error('Could not upload file'));
			};
			xhr.onabort = () => {
				activeAbort = null;
				reject(new DOMException('Transfer cancelled', 'AbortError'));
			};

			const form = new FormData();
			form.append('file', item.file);
			xhr.open('POST', apiUrl(`/upload?path=${encodeURIComponent(remotePath)}`));
			xhr.send(form);
		});
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
		const entriesToMove = minimalRemoteEntries(
			selectedEntryList.length ? selectedEntryList : selected ? [selected] : []
		);
		if (!entriesToMove.length) return;
		await moveEntries(entriesToMove, renamePath.trim());
	}

	async function moveEntries(entriesToMove: RemoteEntry[], target: string) {
		transferCancelled = false;
		error = null;
		lastRetry = () => moveEntries(entriesToMove, target);
		transfer = createTransferProgress({
			kind: 'move',
			label: `Moving ${entriesToMove.length} item${entriesToMove.length === 1 ? '' : 's'}`,
			totalItems: entriesToMove.length
		});

		try {
			for (let index = 0; index < entriesToMove.length; index += 1) {
				assertTransferActive();
				const entry = entriesToMove[index];
				const to =
					entriesToMove.length === 1
						? normalizeTarget(target, path)
						: joinPath(normalizeTarget(target, path), entry.name);
				if (transfer) {
					transfer = updateTransferProgress(transfer, {
						currentName: entry.name,
						completedItems: index
					});
				}
				await request(
					'/rename',
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ from: entry.path, to })
					},
					'Could not rename path'
				);
			}
			if (transfer) {
				transfer = updateTransferProgress(transfer, {
					completedItems: entriesToMove.length,
					status: 'complete'
				});
			}
			lastRetry = null;
			await loadDirectory(path);
		} catch (caught) {
			if (isAbortError(caught)) {
				if (transfer) transfer = updateTransferProgress(transfer, { status: 'cancelled' });
				return;
			}
			error = caught instanceof Error ? caught.message : 'Could not rename path';
			if (transfer) transfer = updateTransferProgress(transfer, { status: 'failed' });
		}
	}

	function requestDeleteSelected() {
		const selectedPathSnapshot = [...selectedPaths];
		const selectedSnapshot = selected;
		const explicitEntries = selectedEntries(entries, selectedPathSnapshot);
		const entriesToDelete = orderedRemoteEntriesForDelete(
			explicitEntries.length ? explicitEntries : selectedSnapshot ? [selectedSnapshot] : []
		);

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
		transfer = createTransferProgress({
			kind: 'delete',
			label: `Deleting ${entriesToDelete.length} item${entriesToDelete.length === 1 ? '' : 's'}`,
			totalItems: entriesToDelete.length
		});

		try {
			for (let index = 0; index < entriesToDelete.length; index += 1) {
				assertTransferActive();
				const entry = entriesToDelete[index];
				if (transfer) {
					transfer = updateTransferProgress(transfer, {
						currentName: entry.name,
						completedItems: index
					});
				}
				await request(
					`/delete?path=${encodeURIComponent(entry.path)}`,
					{ method: 'DELETE' },
					'Could not delete path'
				);
			}
			deleteDialogOpen = false;
			selectedPaths = [];
			selected = null;
			if (transfer) {
				transfer = updateTransferProgress(transfer, {
					completedItems: entriesToDelete.length,
					status: 'complete'
				});
			}
			lastRetry = null;
			await loadDirectory(path);
		} catch (caught) {
			if (isAbortError(caught)) {
				if (transfer) transfer = updateTransferProgress(transfer, { status: 'cancelled' });
				return;
			}
			error = caught instanceof Error ? caught.message : 'Could not delete path';
			if (transfer) transfer = updateTransferProgress(transfer, { status: 'failed' });
		}
	}

	async function downloadSelected() {
		const entriesToDownload = minimalRemoteEntries(
			selectedEntryList.length ? selectedEntryList : selected ? [selected] : []
		);
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
		const uniqueEntriesToDownload = minimalRemoteEntries(entriesToDownload);
		transferCancelled = false;
		error = null;
		lastRetry = () => downloadRecursive(uniqueEntriesToDownload);
		transfer = createTransferProgress({
			kind: 'download',
			label: 'Preparing recursive download',
			totalItems: fileTransferLimits.recursiveMaxFiles
		});

		try {
			const files = uniqueRemoteEntries(uniqueEntriesToDownload.filter(isDownloadableFile));
			const queue = uniqueEntriesToDownload
				.filter((entry) => entry.type === 'directory')
				.map((entry) => normalizePath(entry.path));
			const queuedDirectories = [...queue];
			let scanned = 0;

			while (queue.length) {
				assertTransferActive();
				if (scanned >= fileTransferLimits.recursiveMaxEntries) {
					throw new Error(
						`Recursive download is limited to ${fileTransferLimits.recursiveMaxEntries} scanned entries`
					);
				}
				const directory = queue.shift();
				if (!directory) continue;
				const children = await listDirectory(directory);
				for (const child of children) {
					scanned += 1;
					const childPath = normalizePath(child.path);
					if (child.type === 'directory' && !queuedDirectories.includes(childPath)) {
						queuedDirectories.push(childPath);
						queue.push(childPath);
					}
					if (isDownloadableFile(child)) files.push(child);
					const uniqueFileCount = uniqueRemoteEntries(files).length;
					if (uniqueFileCount > fileTransferLimits.recursiveMaxFiles) {
						throw new Error(
							`Recursive download is limited to ${fileTransferLimits.recursiveMaxFiles} files`
						);
					}
				}
				if (transfer) {
					transfer = updateTransferProgress(transfer, {
						completedItems: Math.min(scanned, fileTransferLimits.recursiveMaxFiles),
						currentName: directory
					});
				}
			}

			const uniqueFiles = uniqueRemoteEntries(files);
			if (!uniqueFiles.length) {
				if (transfer) {
					transfer = updateTransferProgress(transfer, {
						completedItems: 0,
						currentName: null,
						status: 'complete',
						totalItems: 0
					});
				}
				lastRetry = null;
				return;
			}

			await downloadFiles(uniqueFiles);
			lastRetry = null;
		} catch (caught) {
			if (isAbortError(caught)) {
				if (transfer) transfer = updateTransferProgress(transfer, { status: 'cancelled' });
				return;
			}
			error = caught instanceof Error ? caught.message : 'Could not prepare recursive download';
			if (transfer) transfer = updateTransferProgress(transfer, { status: 'failed' });
		}
	}

	async function downloadFiles(files: RemoteEntry[]) {
		const uniqueFiles = uniqueRemoteEntries(files);
		if (!uniqueFiles.length) return;
		transferCancelled = false;
		error = null;
		lastRetry = () => downloadFiles(uniqueFiles);
		const totalBytes = uniqueFiles.reduce((total, entry) => total + Math.max(0, entry.size), 0);
		let completedBytes = 0;
		let completedItems = 0;
		const controller = new AbortController();
		activeAbort = () => {
			transferCancelled = true;
			controller.abort();
		};
		transfer = createTransferProgress({
			kind: 'download',
			label: `Downloading ${uniqueFiles.length} file${uniqueFiles.length === 1 ? '' : 's'}`,
			totalBytes,
			totalItems: uniqueFiles.length
		});

		try {
			for (const entry of uniqueFiles) {
				assertTransferActive();
				transfer = updateTransferProgress(transfer, {
					completedBytes,
					completedItems,
					currentName: entry.name
				});
				const blob = await fetchDownloadBlob(entry, controller.signal, (bytes) => {
					completedBytes += bytes;
					if (transfer) {
						transfer = updateTransferProgress(transfer, {
							completedBytes,
							completedItems,
							currentName: entry.name
						});
					}
				});
				saveDownloadedBlob(entry, blob);
				completedItems += 1;
				if (entry.size > 0 && completedBytes < totalBytes) {
					completedBytes = Math.max(completedBytes, Math.min(totalBytes, completedBytes));
				}
				transfer = updateTransferProgress(transfer, {
					completedBytes,
					completedItems,
					currentName: entry.name
				});
			}
			transfer = updateTransferProgress(transfer, {
				completedBytes: totalBytes || completedBytes,
				completedItems: uniqueFiles.length,
				currentName: null,
				status: 'complete'
			});
			lastRetry = null;
		} catch (caught) {
			if (isAbortError(caught)) {
				if (transfer) transfer = updateTransferProgress(transfer, { status: 'cancelled' });
				return;
			}
			error = caught instanceof Error ? caught.message : 'Could not download file';
			if (transfer) transfer = updateTransferProgress(transfer, { status: 'failed' });
		} finally {
			activeAbort = null;
		}
	}

	async function fetchDownloadBlob(
		entry: RemoteEntry,
		signal: AbortSignal,
		onProgress: (bytes: number) => void
	): Promise<Blob> {
		const response = await fetch(downloadUrl(entry), { signal });
		if (!response.ok) {
			const body = await readApiBody(response, `Could not download ${entry.name}`);
			throw new Error(apiErrorMessage(body, `Could not download ${entry.name}`));
		}

		if (!response.body) {
			const blob = await response.blob();
			onProgress(blob.size);
			return blob;
		}

		const reader = response.body.getReader();
		const chunks: ArrayBuffer[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
				onProgress(value.byteLength);
			}
		}
		return new Blob(chunks, {
			type: response.headers.get('content-type') ?? 'application/octet-stream'
		});
	}

	function saveDownloadedBlob(entry: RemoteEntry, blob: Blob) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = entry.name;
		anchor.rel = 'noopener';
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	}

	async function openText(entry = selected) {
		if (!entry || entry.type !== 'file') return;
		loading = true;
		error = null;
		lastRetry = () => openText(entry);
		try {
			const response = await fetch(apiUrl(`/text?path=${encodeURIComponent(entry.path)}`));
			const body = await readApiBody(response, 'Could not read text file');
			if (!response.ok) throw new Error(apiErrorMessage(body, 'Could not read text file'));
			textPath = typeof body.path === 'string' ? body.path : entry.path;
			textValue = typeof body.text === 'string' ? body.text : '';
			textDirty = false;
			lastRetry = null;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not read text file';
		} finally {
			loading = false;
		}
	}

	async function saveText() {
		if (!textPath) return;
		const saved = await request(
			'/text',
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: textPath, text: textValue })
			},
			'Could not save text file'
		);
		if (saved) {
			textDirty = false;
			await loadDirectory(path);
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
			const response = await fetch(apiUrl(route), { ...init, signal: controller.signal });
			const body = await readApiBody(response, fallback);
			if (!response.ok) {
				if (ignoreFailure) return false;
				throw new Error(apiErrorMessage(body, fallback));
			}
			return true;
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
		if (entry.type === 'file') void openText(entry);
	}

	function downloadUrl(entry: RemoteEntry) {
		return apiUrl(`/download?path=${encodeURIComponent(entry.path)}`);
	}

	function clearRemoteSearchResults() {
		remoteSearchResults = [];
	}

	function formatModified(entry: RemoteEntry) {
		if (!entry.mtime) return entry.rawModifiedAt ?? '-';
		const date = new Date(entry.mtime);
		return Number.isNaN(date.getTime()) ? (entry.rawModifiedAt ?? '-') : date.toLocaleString();
	}

	function modeLabel(entry: RemoteEntry) {
		if (typeof entry.mode !== 'number') return null;
		return `0${(entry.mode & 0o777).toString(8)}`;
	}

	function symlinkTarget(entry: RemoteEntry) {
		if (entry.type !== 'symlink') return null;
		return entry.link ?? entry.longname ?? null;
	}

	async function runRemoteSearch() {
		const query = searchQuery.trim();
		if (!query) return;
		remoteSearching = true;
		error = null;
		lastRetry = () => runRemoteSearch();
		const matches: RemoteEntry[] = [];
		const queue = [path];
		let scannedEntries = 0;
		let scannedDirectories = 0;
		transferCancelled = false;
		transfer = createTransferProgress({
			kind: 'search',
			label: `Searching ${path}`,
			totalItems: fileTransferLimits.remoteSearchMaxEntries
		});

		try {
			while (queue.length) {
				assertTransferActive();
				if (scannedDirectories >= fileTransferLimits.remoteSearchMaxDirectories) break;
				const directory = queue.shift();
				if (!directory) continue;
				scannedDirectories += 1;
				const children = await listDirectory(directory);
				for (const child of children) {
					scannedEntries += 1;
					if (filterRemoteEntries([child], query).length) matches.push(child);
					if (child.type === 'directory') queue.push(child.path);
					if (scannedEntries >= fileTransferLimits.remoteSearchMaxEntries) break;
				}
				if (transfer) {
					transfer = updateTransferProgress(transfer, {
						completedItems: Math.min(scannedEntries, fileTransferLimits.remoteSearchMaxEntries),
						currentName: directory
					});
				}
				if (scannedEntries >= fileTransferLimits.remoteSearchMaxEntries) break;
			}
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
		const normalized = normalizePath(path);
		if (bookmarks.some((bookmark) => bookmark.path === normalized)) return;
		saveBookmarks([
			...bookmarks,
			{
				id: crypto.randomUUID(),
				path: normalized,
				label: normalized === '/' ? '/' : basename(normalized),
				createdAt: new Date().toISOString()
			}
		]);
	}

	function removeBookmark(id: string) {
		saveBookmarks(bookmarks.filter((bookmark) => bookmark.id !== id));
	}

	function saveBookmarks(next: BookmarkEntry[]) {
		bookmarks = next;
		localStorage.setItem(bookmarkStorageKey(), JSON.stringify(next));
	}

	function bookmarkStorageKey() {
		return `termixkit:file-manager:${apiBase}:${hostId}:bookmarks`;
	}

	function loadBookmarks() {
		try {
			const raw = localStorage.getItem(bookmarkStorageKey());
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) bookmarks = parsed.filter(isBookmarkEntry);
		} catch {
			bookmarks = [];
		}
	}

	function isBookmarkEntry(value: unknown): value is BookmarkEntry {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
		const candidate = value as Partial<BookmarkEntry>;
		return (
			typeof candidate.id === 'string' &&
			typeof candidate.path === 'string' &&
			typeof candidate.label === 'string' &&
			typeof candidate.createdAt === 'string'
		);
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

	async function droppedUploadItems(dataTransfer: DataTransfer | null): Promise<UploadItem[]> {
		if (!dataTransfer) return [];
		const transferItems = Array.from(dataTransfer.items ?? []);
		if (!transferItems.length) {
			return Array.from(dataTransfer.files ?? []).map((file) => ({
				file,
				relativePath: file.name,
				directories: []
			}));
		}

		const uploads: UploadItem[] = [];
		let recursiveScan = createRecursiveUploadLimitState();
		for (const item of transferItems) {
			const entry = (
				item as DataTransferItem & {
					webkitGetAsEntry?: () => WebKitFileSystemEntry | null;
				}
			).webkitGetAsEntry?.();
			if (entry?.isDirectory) {
				recursiveScan = await collectEntryUploads(entry, uploads, recursiveScan);
				continue;
			}
			if (entry?.isFile) {
				const file = await fileFromEntry(entry as unknown as WebKitFileSystemFileEntry);
				uploads.push({ file, relativePath: file.name, directories: [] });
				continue;
			}
			const file = item.getAsFile();
			if (file) uploads.push({ file, relativePath: file.name, directories: [] });
		}
		return uploads;
	}

	async function collectEntryUploads(
		entry: WebKitFileSystemEntry,
		uploads: UploadItem[],
		scan: RecursiveUploadLimitState
	): Promise<RecursiveUploadLimitState> {
		let nextScan = countRecursiveUploadEntry(scan);
		if (entry.isFile) {
			const file = await fileFromEntry(entry as WebKitFileSystemFileEntry);
			const relativePath = entry.fullPath.replace(/^\/+/, '') || file.name;
			nextScan = countRecursiveUploadFile(nextScan, file.size);
			uploads.push({
				file,
				relativePath,
				directories: directoryPrefixes(relativePath)
			});
			return nextScan;
		}
		if (!entry.isDirectory) return nextScan;
		const children = await readDirectoryEntries(entry as WebKitFileSystemDirectoryEntry);
		for (const child of children) {
			nextScan = await collectEntryUploads(child, uploads, nextScan);
		}
		return nextScan;
	}

	function fileFromEntry(entry: WebKitFileSystemFileEntry): Promise<globalThis.File> {
		return new Promise((resolve, reject) => entry.file(resolve, reject));
	}

	function readDirectoryEntries(
		entry: WebKitFileSystemDirectoryEntry
	): Promise<WebKitFileSystemEntry[]> {
		const reader = entry.createReader();
		const entries: WebKitFileSystemEntry[] = [];

		return new Promise((resolve, reject) => {
			function readBatch() {
				reader.readEntries((batch) => {
					if (!batch.length) {
						resolve(entries);
						return;
					}
					entries.push(...batch);
					readBatch();
				}, reject);
			}
			readBatch();
		});
	}

	function directoryPrefixes(relativePath: string) {
		const parts = relativePath.split('/').filter(Boolean);
		const prefixes: string[] = [];
		for (let index = 1; index < parts.length; index += 1) {
			prefixes.push(parts.slice(0, index).join('/'));
		}
		return prefixes;
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

	function isAbortError(caught: unknown) {
		return caught instanceof DOMException && caught.name === 'AbortError';
	}

	async function readApiBody(response: Response, fallback: string): Promise<ApiResponseBody> {
		const responseText = await response.text().catch(() => '');
		const body = parseApiResponseBody(responseText);
		if (body) return body;
		if (!response.ok) throw new Error(responseError(responseText, fallback));
		return {};
	}

	function apiErrorMessage(body: ApiResponseBody, fallback: string) {
		if (typeof body.error === 'string' && body.error.trim()) return body.error;
		if (Array.isArray(body.issues)) {
			const issues = body.issues.filter((issue): issue is string => typeof issue === 'string');
			if (issues.length) return issues.join('; ');
		}
		return fallback;
	}

	function responseError(responseText: string, fallback: string) {
		const body = parseApiResponseBody(responseText);
		if (body) return apiErrorMessage(body, fallback);
		const plainText = compactResponseText(responseText);
		return plainText ? `${fallback}: ${plainText}` : fallback;
	}

	function parseApiResponseBody(responseText: string): ApiResponseBody | null {
		try {
			const body = JSON.parse(responseText);
			return typeof body === 'object' && body !== null && !Array.isArray(body) ? body : null;
		} catch {
			return null;
		}
	}

	function compactResponseText(responseText: string) {
		const compact = responseText.replace(/\s+/g, ' ').trim();
		return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
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
			return textPath;
		},
		set textPath(value) {
			textPath = value;
		},
		get textValue() {
			return textValue;
		},
		set textValue(value) {
			textValue = value;
		},
		get textDirty() {
			return textDirty;
		},
		set textDirty(value) {
			textDirty = value;
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
			return saveText;
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
			return openText;
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
