import {
	countRecursiveUploadEntry,
	countRecursiveUploadFile,
	createRecursiveUploadLimitState,
	type RecursiveUploadLimitState
} from './file-manager-state';

export type UploadItem = {
	file: globalThis.File;
	relativePath: string;
	directories: string[];
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

export async function droppedUploadItems(dataTransfer: DataTransfer | null): Promise<UploadItem[]> {
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
