<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import {
		Ban,
		Bookmark,
		BookmarkPlus,
		ChevronDown,
		ChevronRight,
		Download,
		File as FileIcon,
		FileSymlink,
		Folder,
		FolderDown,
		FolderPlus,
		Link,
		MoveRight,
		Pencil,
		RefreshCw,
		RotateCcw,
		Save,
		Search,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Input } from '$lib/components/ui/input';
	import { Progress } from '$lib/components/ui/progress';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import StatePanel from '../StatePanel.svelte';
	import {
		assertRecursiveUploadItemsWithinLimits,
		basename,
		countRecursiveUploadEntry,
		countRecursiveUploadFile,
		createTransferProgress,
		createRecursiveUploadLimitState,
		dirname,
		entryTypeLabel,
		fileTransferLimits,
		filterRemoteEntries,
		formatDuration,
		formatSize,
		formatThroughput,
		isDownloadableFile,
		joinPath,
		normalizePath,
		normalizeTarget,
		orderedRemoteEntriesForDelete,
		parentPath,
		selectedEntries,
		selectionSummary,
		setVisibleSelection,
		toggleSelectedPath,
		transferPercent,
		updateTransferProgress,
		type RemoteEntry,
		type RecursiveUploadLimitState,
		type TransferProgress
	} from './file-manager-state';

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
		file: (
			success: (file: globalThis.File) => void,
			failure: (error: DOMException) => void
		) => void;
	};

	type WebKitFileSystemDirectoryEntry = WebKitFileSystemEntry & {
		createReader: () => {
			readEntries: (
				success: (entries: WebKitFileSystemEntry[]) => void,
				failure: (error: DOMException) => void
			) => void;
		};
	};

	let {
		hostId,
		initialPath = '/',
		apiBase = 'sftp',
		label = 'SFTP'
	}: { hostId: string; initialPath?: string; apiBase?: ApiBase; label?: string } = $props();

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
	let fileInput: HTMLInputElement;
	let activeAbort = $state<(() => void) | null>(null);
	let transferCancelled = false;
	let desktop = $state(browser ? window.matchMedia('(min-width: 1024px)').matches : false);
	let managerElement = $state<HTMLElement | null>(null);
	let wideLayout = $state(false);

	let visibleEntries = $derived(filterRemoteEntries(entries, searchQuery));
	let selectedEntryList = $derived(selectedEntries(entries, selectedPaths));
	let selection = $derived(selectionSummary(visibleEntries, selectedPaths));
	let activeSelectionEntries = $derived(
		selectedEntryList.length ? selectedEntryList : selected ? [selected] : []
	);
	let selectedDeleteEntries = $derived(orderedRemoteEntriesForDelete(activeSelectionEntries));
	let selectedDeleteDirectoryCount = $derived(
		selectedDeleteEntries.filter((entry) => entry.type === 'directory').length
	);
	let selectedTotalBytes = $derived(
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

	function minimalRemoteEntries(entriesToCollapse: RemoteEntry[]): RemoteEntry[] {
		const uniqueEntries = uniqueRemoteEntries(entriesToCollapse).sort((left, right) => {
			const leftPath = normalizePath(left.path);
			const rightPath = normalizePath(right.path);
			if (leftPath === rightPath) return 0;
			return leftPath.localeCompare(rightPath);
		});
		const keptDirectories: string[] = [];
		const minimal: RemoteEntry[] = [];

		for (const entry of uniqueEntries) {
			const normalized = normalizePath(entry.path);
			if (keptDirectories.some((directory) => isDescendantPath(normalized, directory))) continue;
			minimal.push(entry);
			if (entry.type === 'directory') keptDirectories.push(normalized);
		}

		return minimal;
	}

	function uniqueRemoteEntries(entriesToDedupe: RemoteEntry[]): RemoteEntry[] {
		const seen: string[] = [];
		const unique: RemoteEntry[] = [];

		for (const entry of entriesToDedupe) {
			const normalized = normalizePath(entry.path);
			if (seen.includes(normalized)) continue;
			seen.push(normalized);
			unique.push(entry);
		}

		return unique;
	}

	function isDescendantPath(pathToCheck: string, ancestorPath: string): boolean {
		const pathWithSlash = `${normalizePath(pathToCheck)}/`;
		const ancestorWithSlash = `${normalizePath(ancestorPath).replace(/\/$/, '')}/`;
		return pathWithSlash.startsWith(ancestorWithSlash) && pathWithSlash !== ancestorWithSlash;
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
</script>

{#snippet resizeHandle(handleLabel = `Resize ${label.toLowerCase()} file-manager pane boundary`)}
	<Resizable.Handle
		withHandle
		tabindex={0}
		aria-label={handleLabel}
		class="bg-transparent hover:bg-muted/60 focus-visible:ring-2 data-[direction=horizontal]:mx-1 data-[direction=horizontal]:w-2 data-[direction=horizontal]:after:w-2 data-[direction=vertical]:my-1 data-[direction=vertical]:h-2 data-[direction=vertical]:after:h-2"
	/>
{/snippet}

{#snippet bookmarksPane()}
	<aside
		class={`h-full min-h-0 border-b p-2 transition-[padding] lg:border-r lg:border-b-0 ${
			bookmarksOpen ? '' : 'lg:p-1'
		}`}
	>
		<Collapsible.Root bind:open={bookmarksOpen}>
			<Collapsible.Trigger
				class={`mb-2 flex h-7 w-full items-center rounded-md text-xs font-medium text-muted-foreground outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
					bookmarksOpen ? 'justify-between px-1 text-left' : 'justify-center px-0'
				}`}
				aria-label={`${bookmarksOpen ? 'Collapse' : 'Expand'} bookmarks`}
				title={`${bookmarksOpen ? 'Collapse' : 'Expand'} bookmarks`}
			>
				<span
					class={`flex min-w-0 items-center ${bookmarksOpen ? 'gap-1.5' : 'justify-center gap-1'}`}
				>
					{#if bookmarksOpen}
						<ChevronDown class="size-3.5 shrink-0" />
					{:else}
						<ChevronRight class="size-3.5 shrink-0" />
					{/if}
					{#if bookmarksOpen}
						<span>Bookmarks</span>
						<span class="text-[11px] text-muted-foreground/75">({bookmarks.length})</span>
					{/if}
				</span>
				<Bookmark class="size-3.5 shrink-0 text-muted-foreground" />
			</Collapsible.Trigger>
			<Collapsible.Content>
				<div class="space-y-1">
					{#each bookmarks as bookmark (bookmark.id)}
						<div class="flex items-center gap-1">
							<Button
								size="xs"
								variant={bookmark.path === path ? 'secondary' : 'ghost'}
								class="min-w-0 flex-1 justify-start font-mono"
								title={bookmark.path}
								onclick={() => loadDirectory(bookmark.path)}
							>
								<span class="truncate">{bookmark.label}</span>
							</Button>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`Remove bookmark ${bookmark.path}`}
								onclick={() => removeBookmark(bookmark.id)}
							>
								<X class="size-3" />
							</Button>
						</div>
					{:else}
						<div class="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
							No bookmarks for this host.
						</div>
					{/each}
				</div>
			</Collapsible.Content>
		</Collapsible.Root>

		{#if bookmarksOpen && remoteSearchResults.length}
			<div class="mt-4 border-t pt-3">
				<div class="mb-2 text-xs font-medium text-muted-foreground">
					Search results ({remoteSearchResults.length})
				</div>
				<div class="max-h-52 space-y-1 overflow-auto">
					{#each remoteSearchResults as result (result.path)}
						<Button
							size="xs"
							variant="ghost"
							class="w-full justify-start font-mono"
							title={result.path}
							onclick={() => openSearchResult(result)}
						>
							{#if result.type === 'directory'}
								<Folder class="size-3.5 text-amber-500" />
							{:else if result.type === 'symlink'}
								<FileSymlink class="size-3.5 text-sky-500" />
							{:else}
								<FileIcon class="size-3.5 text-muted-foreground" />
							{/if}
							<span class="truncate">{result.path}</span>
						</Button>
					{/each}
				</div>
			</div>
		{/if}
	</aside>
{/snippet}

{#snippet fileListPane()}
	<div class="relative h-full min-h-0 min-w-0 overflow-auto">
		{#if dragging}
			<div
				class="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-md border-2 border-dashed border-primary bg-background/85 text-sm font-medium"
			>
				Drop files or folders to upload into {path}
			</div>
		{/if}

		<Table.Root>
			<Table.Header class="sticky top-0 z-10 bg-background">
				<Table.Row>
					<Table.Head class="w-10">
						<Checkbox
							aria-label="Select visible entries"
							checked={selection.allVisible}
							indeterminate={selection.someVisible}
							onclick={(event) => {
								event.stopPropagation();
								toggleVisible(!selection.allVisible);
							}}
						/>
					</Table.Head>
					<Table.Head>Name</Table.Head>
					<Table.Head class="w-28">Type</Table.Head>
					<Table.Head class="w-28">Size</Table.Head>
					<Table.Head class="w-44">Modified</Table.Head>
					<Table.Head class="w-20" aria-label="Actions"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each visibleEntries as entry (entry.path)}
					<Table.Row
						data-selected={selected?.path === entry.path || selectedPaths.includes(entry.path)}
						onclick={() => selectEntry(entry)}
					>
						<Table.Cell>
							<Checkbox
								aria-label={`Select ${entry.name}`}
								checked={selectedPaths.includes(entry.path)}
								onclick={(event) => {
									event.stopPropagation();
									toggleEntry(entry, !selectedPaths.includes(entry.path));
								}}
							/>
						</Table.Cell>
						<Table.Cell>
							<Button
								variant="ghost"
								size="sm"
								class="max-w-full justify-start px-1 font-normal"
								title={entry.path}
								onclick={(event) => (event.stopPropagation(), activateEntry(entry))}
							>
								{#if entry.type === 'directory'}
									<Folder class="size-4 text-amber-500" />
								{:else if entry.type === 'symlink'}
									<FileSymlink class="size-4 text-sky-500" />
								{:else}
									<FileIcon class="size-4 text-muted-foreground" />
								{/if}
								<span class="truncate">{entry.name}</span>
							</Button>
							{#if symlinkTarget(entry)}
								<div
									class="mt-1 flex items-center gap-1 pl-1 font-mono text-[11px] text-muted-foreground"
								>
									<Link class="size-3" />
									<span class="truncate">{symlinkTarget(entry)}</span>
								</div>
							{/if}
						</Table.Cell>
						<Table.Cell>
							<Badge variant={entry.type === 'symlink' ? 'outline' : 'secondary'}>
								{entryTypeLabel(entry)}
							</Badge>
						</Table.Cell>
						<Table.Cell class="font-mono text-xs text-muted-foreground">
							{entry.type === 'directory' ? '-' : formatSize(entry.size)}
							{#if modeLabel(entry)}
								<div>{modeLabel(entry)}</div>
							{/if}
						</Table.Cell>
						<Table.Cell class="font-mono text-xs text-muted-foreground">
							{formatModified(entry)}
						</Table.Cell>
						<Table.Cell>
							{#if isDownloadableFile(entry)}
								<Button
									size="icon-sm"
									variant="ghost"
									href={downloadUrl(entry)}
									download={entry.name}
									aria-label={`Download ${entry.name}`}
									onclick={(event) => event.stopPropagation()}
								>
									<Download class="size-4" />
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
							{searchQuery ? 'No matching entries.' : 'No entries.'}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>

		{#if loading || error}
			<StatePanel
				state={error ? 'error' : 'loading'}
				title={error ? `${label} request failed` : 'Loading remote directory'}
				detail={error ?? path}
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		{/if}
	</div>
{/snippet}

{#snippet editorPane()}
	<div class="flex h-full min-h-0 min-w-0 flex-col border-t p-2 lg:border-t-0 lg:border-l">
		<div class="mb-2 flex h-8 shrink-0 items-center justify-between gap-2">
			<div class="min-w-0 truncate font-mono text-xs text-muted-foreground">
				{textPath ?? 'No text file open'}
			</div>
			<Button
				size="icon-sm"
				variant="outline"
				aria-label="Save text file"
				disabled={!textPath || !textDirty}
				onclick={saveText}
			>
				<Save class="size-4" />
			</Button>
		</div>
		<Textarea
			class="min-h-40 flex-1 resize-none font-mono text-xs"
			placeholder="Open a text file to edit it"
			bind:value={textValue}
			disabled={!textPath}
			oninput={() => (textDirty = Boolean(textPath))}
		/>
	</div>
{/snippet}

<div
	bind:this={managerElement}
	class={`grid h-full min-h-0 min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-md border transition-colors ${dragging ? 'border-primary bg-primary/5' : ''}`}
	role="region"
	aria-label={`${label} file manager`}
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={handleDrop}
>
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
			<Button size="sm" variant="outline" onclick={() => fileInput.click()}>
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
						remoteSearchResults = [];
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
				aria-label={selectedPaths.length > 1
					? 'Move selected paths'
					: 'Rename or move selected path'}
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
			{#if selection.count}
				<Badge variant="secondary">{selection.count} selected</Badge>
				<Badge variant="outline">{formatSize(selectedTotalBytes)}</Badge>
			{/if}
		</div>

		{#if transfer}
			<div class="rounded-md border bg-background p-2">
				<div class="mb-1 flex items-center justify-between gap-3 text-xs">
					<div class="min-w-0 truncate">
						<span class="font-medium">{transfer.label}</span>
						{#if transfer.currentName}
							<span class="text-muted-foreground"> · {transfer.currentName}</span>
						{/if}
					</div>
					<div class="shrink-0 font-mono text-muted-foreground">
						{transferPercent(transfer)}% · {formatThroughput(transfer.throughputBytesPerSecond)} · {formatDuration(
							transfer.remainingMs
						)}
					</div>
				</div>
				<Progress value={transferPercent(transfer)} />
				<div class="mt-1 flex justify-between text-[11px] text-muted-foreground">
					<span
						>{transfer.completedItems}/{transfer.totalItems || transfer.completedItems} items</span
					>
					<span>{formatSize(transfer.completedBytes)}/{formatSize(transfer.totalBytes)}</span>
				</div>
			</div>
		{/if}
	</div>

	<Resizable.PaneGroup
		direction={desktop && wideLayout ? 'horizontal' : 'vertical'}
		keyboardResizeBy={5}
		autoSaveId={`termixkit-file-manager:${apiBase}:${hostId}:${desktop && wideLayout ? 'wide' : 'stacked'}`}
		class="min-h-0 min-w-0"
	>
		<Resizable.Pane
			defaultSize={desktop && wideLayout ? (bookmarksOpen ? 18 : 7) : 18}
			minSize={desktop && wideLayout ? 6 : 10}
		>
			{@render bookmarksPane()}
		</Resizable.Pane>
		{@render resizeHandle()}
		<Resizable.Pane
			defaultSize={desktop && wideLayout ? 56 : 56}
			minSize={desktop && wideLayout ? 34 : 32}
		>
			{@render fileListPane()}
		</Resizable.Pane>
		{@render resizeHandle()}
		<Resizable.Pane
			defaultSize={desktop && wideLayout ? 26 : 26}
			minSize={desktop && wideLayout ? 18 : 16}
		>
			{@render editorPane()}
		</Resizable.Pane>
	</Resizable.PaneGroup>

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
						Directory removal uses the remote server empty-directory operation; non-empty
						directories may fail.
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
							: 's'} and upload {pendingRecursive.items.length} file{pendingRecursive.items
							.length === 1
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
</div>
