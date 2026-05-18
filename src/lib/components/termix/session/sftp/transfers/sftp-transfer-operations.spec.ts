import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	fileTransferLimits,
	type RemoteEntry,
	type TransferProgress
} from '../state/file-manager-state';
import {
	assertUploadItemsWithinLimits,
	runDeleteEntries,
	runDownloadFiles,
	runMoveEntries,
	runUploadItems
} from './sftp-transfer-operations';
import type { UploadItem } from './sftp-upload-drop';
import { fetchDownloadBlob, saveDownloadedBlob, uploadFile } from './sftp-transfer-io';

vi.mock('./sftp-transfer-io', () => ({
	fetchDownloadBlob: vi.fn(),
	saveDownloadedBlob: vi.fn(),
	uploadFile: vi.fn()
}));

function uploadItem(size: number, directories: string[] = []): UploadItem {
	return {
		file: new File(['x'.repeat(size)], 'upload.txt'),
		relativePath: 'upload.txt',
		directories
	};
}

describe('sftp transfer operations', () => {
	beforeEach(() => {
		vi.mocked(fetchDownloadBlob).mockReset();
		vi.mocked(saveDownloadedBlob).mockReset();
		vi.mocked(uploadFile).mockReset();
	});

	it('allows flat uploads without recursive limit checks', () => {
		expect(() =>
			assertUploadItemsWithinLimits([uploadItem(fileTransferLimits.uploadMaxBytes)])
		).not.toThrow();
	});

	it('enforces recursive upload file limits', () => {
		const items = Array.from({ length: fileTransferLimits.recursiveMaxFiles + 1 }, (_, index) =>
			uploadItem(1, [`folder-${index}`])
		);

		expect(() => assertUploadItemsWithinLimits(items)).toThrow('Recursive upload is limited');
	});

	it('moves entries and reloads the current directory', async () => {
		const runtime = createRuntime();
		const result = await runMoveEntries(
			runtime.value,
			[entry({ name: 'a.txt', path: '/old/a.txt' })],
			'/new'
		);

		expect(result).toEqual({});
		expect(runtime.requests).toEqual([
			[
				'/rename',
				expect.objectContaining({
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ from: '/old/a.txt', to: '/new' })
				}),
				'Could not rename path'
			]
		]);
		expect(runtime.loaded).toEqual(['/current']);
		expect(runtime.transfer?.status).toBe('complete');
	});

	it('deletes entries and reports failed requests', async () => {
		const runtime = createRuntime({
			request: async () => {
				throw new Error('delete denied');
			}
		});

		const result = await runDeleteEntries(runtime.value, [entry({ path: '/tmp/a b.txt' })]);

		expect(result).toEqual({ error: 'delete denied' });
		expect(runtime.requests[0][0]).toBe('/delete?path=%2Ftmp%2Fa%20b.txt');
		expect(runtime.transfer?.status).toBe('failed');
	});

	it('uploads files with directory creation and progress updates', async () => {
		const runtime = createRuntime();
		vi.mocked(uploadFile).mockImplementation(async ({ onProgress, onAbortReady, onAbortClear }) => {
			onAbortReady(vi.fn());
			onProgress(2);
			onAbortClear();
		});

		const result = await runUploadItems(runtime.value, [
			{
				file: new File(['hello'], 'a.txt'),
				relativePath: 'folder/a.txt',
				directories: ['folder']
			}
		]);

		expect(result).toEqual({});
		expect(runtime.requests[0]).toEqual([
			'/mkdir',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ path: '/current/folder' })
			}),
			'Could not create upload directory',
			true
		]);
		expect(uploadFile).toHaveBeenCalledWith(
			expect.objectContaining({ url: '/upload?path=%2Fcurrent%2Ffolder%2Fa.txt' })
		);
		expect(runtime.loaded).toEqual(['/current']);
		expect(runtime.transfer?.status).toBe('complete');
		expect(runtime.activeAbort).toBeNull();
	});

	it('downloads unique files and saves completed blobs', async () => {
		const runtime = createRuntime();
		vi.mocked(fetchDownloadBlob).mockImplementation(async (_entry, _url, _signal, onProgress) => {
			onProgress(3);
			return new Blob(['abc']);
		});

		const result = await runDownloadFiles(runtime.value, [
			entry({ name: 'a.txt', path: '/a.txt', size: 3 }),
			entry({ name: 'a.txt', path: '/a.txt', size: 3 }),
			entry({ name: 'folder', path: '/folder', type: 'directory', size: 0 })
		]);

		expect(result).toEqual({});
		expect(fetchDownloadBlob).toHaveBeenCalledOnce();
		expect(saveDownloadedBlob).toHaveBeenCalledOnce();
		expect(runtime.transfer).toMatchObject({
			status: 'complete',
			completedBytes: 3,
			completedItems: 1
		});
		expect(runtime.activeAbort).toBeNull();
	});

	it('marks aborted downloads as cancelled', async () => {
		const runtime = createRuntime();
		vi.mocked(fetchDownloadBlob).mockRejectedValue(
			new DOMException('Transfer cancelled', 'AbortError')
		);

		const result = await runDownloadFiles(runtime.value, [entry()]);

		expect(result).toEqual({ cancelled: true });
		expect(runtime.transfer?.status).toBe('cancelled');
	});
});

function createRuntime(overrides: { request?: (...args: RequestRecord) => Promise<boolean> } = {}) {
	let transfer: TransferProgress | null = null;
	let activeAbort: (() => void) | null = null;
	let cancelled = false;
	const requests: RequestRecord[] = [];
	const loaded: string[] = [];
	const request = async (...args: RequestRecord) => {
		requests.push(args);
		return overrides.request?.(...args) ?? true;
	};

	const value = {
		getCurrentPath: () => '/current',
		getTransfer: () => transfer,
		setTransfer: (next: TransferProgress | null) => {
			transfer = next;
		},
		setActiveAbort: (abort: (() => void) | null) => {
			activeAbort = abort;
		},
		markTransferCancelled: () => {
			cancelled = true;
		},
		assertTransferActive: () => {
			if (!transfer || transfer.status === 'cancelled') {
				throw new DOMException('Transfer cancelled', 'AbortError');
			}
		},
		request,
		loadDirectory: async (path: string) => {
			loaded.push(path);
		},
		listDirectory: async () => [],
		client: {
			url: (route: string) => route,
			list: async () => ({ path: '/current', entries: [] }),
			request: async () => true,
			downloadUrl: (remoteEntry: RemoteEntry) =>
				`/download?path=${encodeURIComponent(remoteEntry.path)}`,
			uploadUrl: (remotePath: string) => `/upload?path=${encodeURIComponent(remotePath)}`,
			readText: async () => ''
		}
	} as Parameters<typeof runMoveEntries>[0];

	return {
		value,
		requests,
		loaded,
		get transfer() {
			return transfer;
		},
		get activeAbort() {
			return activeAbort;
		},
		get cancelled() {
			return cancelled;
		}
	};
}

type RequestRecord = [string, RequestInit, string, boolean?];

function entry(overrides: Partial<RemoteEntry> = {}): RemoteEntry {
	return {
		name: 'a.txt',
		path: '/a.txt',
		type: 'file',
		size: 1,
		mtime: null,
		...overrides
	};
}
