import {
	assertRecursiveUploadItemsWithinLimits,
	createTransferProgress,
	fileTransferLimits,
	isDownloadableFile,
	joinPath,
	uniqueRemoteEntries,
	updateTransferProgress,
	type RemoteEntry,
	type TransferProgress
} from '../state/file-manager-state';
import {
	isAbortError,
	moveTargetForEntry,
	recursiveUploadLimitItems,
	transferItemLabel,
	uploadDirectoryPaths
} from '../controller/sftp-browser-actions';
import type { createSftpClient } from '../api/sftp-client';
import { collectRecursiveDownloadFiles } from './sftp-recursive-download';
import { fetchDownloadBlob, saveDownloadedBlob, uploadFile } from './sftp-transfer-io';
import type { UploadItem } from './sftp-upload-drop';

type SftpClient = ReturnType<typeof createSftpClient>;
type ControllerRequest = (
	route: string,
	init: RequestInit,
	fallback: string,
	ignoreFailure?: boolean
) => Promise<boolean>;

type TransferRuntime = {
	getCurrentPath: () => string;
	getTransfer: () => TransferProgress | null;
	setTransfer: (transfer: TransferProgress | null) => void;
	setActiveAbort: (abort: (() => void) | null) => void;
	markTransferCancelled: () => void;
	assertTransferActive: () => void;
	request: ControllerRequest;
	loadDirectory: (path: string) => Promise<void>;
	listDirectory: (path: string) => Promise<RemoteEntry[]>;
	client: SftpClient;
};

export type SftpTransferResult = {
	cancelled?: boolean;
	error?: string;
};

function currentTransfer(runtime: TransferRuntime): TransferProgress {
	const transfer = runtime.getTransfer();
	if (!transfer) throw new DOMException('Transfer cancelled', 'AbortError');
	return transfer;
}

export function assertUploadItemsWithinLimits(items: UploadItem[]) {
	if (!items.some((item) => item.directories.length > 0)) return;
	assertRecursiveUploadItemsWithinLimits(recursiveUploadLimitItems(items));
}

export async function runUploadItems(
	runtime: TransferRuntime,
	items: UploadItem[]
): Promise<SftpTransferResult> {
	const totalBytes = items.reduce((total, item) => total + item.file.size, 0);
	let completedBytes = 0;
	let completedItems = 0;
	runtime.setTransfer(
		createTransferProgress({
			kind: 'upload',
			label: transferItemLabel('Uploading', items.length),
			totalBytes,
			totalItems: items.length
		})
	);

	try {
		await ensureUploadDirectories(runtime, items);
		for (const item of items) {
			runtime.assertTransferActive();
			runtime.setTransfer(
				updateTransferProgress(currentTransfer(runtime), {
					currentName: item.relativePath,
					completedBytes,
					completedItems
				})
			);
			await uploadOne(runtime, item, (loaded) => {
				if (!runtime.getTransfer()) return;
				runtime.setTransfer(
					updateTransferProgress(currentTransfer(runtime), {
						completedBytes: completedBytes + loaded,
						completedItems,
						currentName: item.relativePath
					})
				);
			});
			completedBytes += item.file.size;
			completedItems += 1;
			runtime.setTransfer(
				updateTransferProgress(currentTransfer(runtime), {
					completedBytes,
					completedItems,
					currentName: item.relativePath
				})
			);
		}
		runtime.setTransfer(updateTransferProgress(currentTransfer(runtime), { status: 'complete' }));
		await runtime.loadDirectory(runtime.getCurrentPath());
		return {};
	} catch (caught) {
		return handleTransferError(runtime, caught, 'Could not upload file');
	} finally {
		runtime.setActiveAbort(null);
	}
}

export async function runMoveEntries(
	runtime: TransferRuntime,
	entriesToMove: RemoteEntry[],
	target: string
): Promise<SftpTransferResult> {
	runtime.setTransfer(
		createTransferProgress({
			kind: 'move',
			label: transferItemLabel('Moving', entriesToMove.length),
			totalItems: entriesToMove.length
		})
	);

	try {
		for (let index = 0; index < entriesToMove.length; index += 1) {
			runtime.assertTransferActive();
			const entry = entriesToMove[index];
			const to = moveTargetForEntry({
				entry,
				entriesToMove,
				target,
				currentPath: runtime.getCurrentPath()
			});
			runtime.setTransfer(
				updateTransferProgress(currentTransfer(runtime), {
					currentName: entry.name,
					completedItems: index
				})
			);
			await runtime.request(
				'/rename',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ from: entry.path, to })
				},
				'Could not rename path'
			);
		}
		runtime.setTransfer(
			updateTransferProgress(currentTransfer(runtime), {
				completedItems: entriesToMove.length,
				status: 'complete'
			})
		);
		await runtime.loadDirectory(runtime.getCurrentPath());
		return {};
	} catch (caught) {
		return handleTransferError(runtime, caught, 'Could not rename path');
	}
}

export async function runDeleteEntries(
	runtime: TransferRuntime,
	entriesToDelete: RemoteEntry[]
): Promise<SftpTransferResult> {
	runtime.setTransfer(
		createTransferProgress({
			kind: 'delete',
			label: transferItemLabel('Deleting', entriesToDelete.length),
			totalItems: entriesToDelete.length
		})
	);

	try {
		for (let index = 0; index < entriesToDelete.length; index += 1) {
			runtime.assertTransferActive();
			const entry = entriesToDelete[index];
			runtime.setTransfer(
				updateTransferProgress(currentTransfer(runtime), {
					currentName: entry.name,
					completedItems: index
				})
			);
			await runtime.request(
				`/delete?path=${encodeURIComponent(entry.path)}`,
				{ method: 'DELETE' },
				'Could not delete path'
			);
		}
		runtime.setTransfer(
			updateTransferProgress(currentTransfer(runtime), {
				completedItems: entriesToDelete.length,
				status: 'complete'
			})
		);
		await runtime.loadDirectory(runtime.getCurrentPath());
		return {};
	} catch (caught) {
		return handleTransferError(runtime, caught, 'Could not delete path');
	}
}

export async function runDownloadRecursive(
	runtime: TransferRuntime,
	entriesToDownload: RemoteEntry[]
): Promise<SftpTransferResult> {
	runtime.setTransfer(
		createTransferProgress({
			kind: 'download',
			label: 'Preparing recursive download',
			totalItems: fileTransferLimits.recursiveMaxFiles
		})
	);

	try {
		const uniqueFiles = await collectRecursiveDownloadFiles({
			entries: entriesToDownload,
			listDirectory: runtime.listDirectory,
			assertActive: runtime.assertTransferActive,
			onProgress: ({ directory, scanned }) => {
				runtime.setTransfer(
					updateTransferProgress(currentTransfer(runtime), {
						completedItems: Math.min(scanned, fileTransferLimits.recursiveMaxFiles),
						currentName: directory
					})
				);
			}
		});
		if (!uniqueFiles.length) {
			runtime.setTransfer(
				updateTransferProgress(currentTransfer(runtime), {
					completedItems: 0,
					currentName: null,
					status: 'complete',
					totalItems: 0
				})
			);
			return {};
		}

		return runDownloadFiles(runtime, uniqueFiles);
	} catch (caught) {
		return handleTransferError(runtime, caught, 'Could not prepare recursive download');
	}
}

export async function runDownloadFiles(
	runtime: TransferRuntime,
	files: RemoteEntry[]
): Promise<SftpTransferResult> {
	const uniqueFiles = uniqueRemoteEntries(files).filter(isDownloadableFile);
	if (!uniqueFiles.length) return {};
	const totalBytes = uniqueFiles.reduce((total, entry) => total + Math.max(0, entry.size), 0);
	let completedBytes = 0;
	let completedItems = 0;
	const controller = new AbortController();
	runtime.setActiveAbort(() => {
		runtime.markTransferCancelled();
		controller.abort();
	});
	runtime.setTransfer(
		createTransferProgress({
			kind: 'download',
			label: transferItemLabel('Downloading', uniqueFiles.length, 'file'),
			totalBytes,
			totalItems: uniqueFiles.length
		})
	);

	try {
		for (const entry of uniqueFiles) {
			runtime.assertTransferActive();
			runtime.setTransfer(
				updateTransferProgress(currentTransfer(runtime), {
					completedBytes,
					completedItems,
					currentName: entry.name
				})
			);
			const blob = await fetchDownloadBlob(
				entry,
				runtime.client.downloadUrl(entry),
				controller.signal,
				(bytes) => {
					completedBytes += bytes;
					runtime.setTransfer(
						updateTransferProgress(currentTransfer(runtime), {
							completedBytes,
							completedItems,
							currentName: entry.name
						})
					);
				}
			);
			saveDownloadedBlob(entry, blob);
			completedItems += 1;
			if (entry.size > 0 && completedBytes < totalBytes) {
				completedBytes = Math.max(completedBytes, Math.min(totalBytes, completedBytes));
			}
			runtime.setTransfer(
				updateTransferProgress(currentTransfer(runtime), {
					completedBytes,
					completedItems,
					currentName: entry.name
				})
			);
		}
		runtime.setTransfer(
			updateTransferProgress(currentTransfer(runtime), {
				completedBytes: totalBytes || completedBytes,
				completedItems: uniqueFiles.length,
				currentName: null,
				status: 'complete'
			})
		);
		return {};
	} catch (caught) {
		return handleTransferError(runtime, caught, 'Could not download file');
	} finally {
		runtime.setActiveAbort(null);
	}
}

async function ensureUploadDirectories(runtime: TransferRuntime, items: UploadItem[]) {
	for (const directory of uploadDirectoryPaths(items)) {
		runtime.assertTransferActive();
		await runtime
			.request(
				'/mkdir',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ path: joinPath(runtime.getCurrentPath(), directory) })
				},
				'Could not create upload directory',
				true
			)
			.catch(() => null);
	}
}

function uploadOne(
	runtime: TransferRuntime,
	item: UploadItem,
	onProgress: (loaded: number) => void
): Promise<void> {
	return uploadFile({
		url: runtime.client.uploadUrl(joinPath(runtime.getCurrentPath(), item.relativePath)),
		file: item.file,
		onProgress,
		onAbortReady: (abort) => {
			runtime.setActiveAbort(() => {
				runtime.markTransferCancelled();
				abort();
			});
		},
		onAbortClear: () => {
			runtime.setActiveAbort(null);
		}
	});
}

function handleTransferError(
	runtime: TransferRuntime,
	caught: unknown,
	fallback: string
): SftpTransferResult {
	if (isAbortError(caught)) {
		runtime.setTransfer(updateTransferProgress(currentTransfer(runtime), { status: 'cancelled' }));
		return { cancelled: true };
	}
	runtime.setTransfer(updateTransferProgress(currentTransfer(runtime), { status: 'failed' }));
	return { error: caught instanceof Error ? caught.message : fallback };
}
