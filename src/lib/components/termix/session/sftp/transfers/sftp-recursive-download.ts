import {
	fileTransferLimits,
	isDownloadableFile,
	minimalRemoteEntries,
	normalizePath,
	uniqueRemoteEntries,
	type RemoteEntry
} from '../state/file-manager-state';

export type RecursiveDownloadProgress = {
	directory: string;
	scanned: number;
};

export async function collectRecursiveDownloadFiles({
	entries,
	listDirectory,
	assertActive,
	onProgress
}: {
	entries: RemoteEntry[];
	listDirectory: (path: string) => Promise<RemoteEntry[]>;
	assertActive: () => void;
	onProgress?: (progress: RecursiveDownloadProgress) => void;
}) {
	const uniqueEntriesToDownload = minimalRemoteEntries(entries);
	const files = uniqueRemoteEntries(uniqueEntriesToDownload.filter(isDownloadableFile));
	const queue = uniqueEntriesToDownload
		.filter((entry) => entry.type === 'directory')
		.map((entry) => normalizePath(entry.path));
	const queuedDirectories = [...queue];
	let scanned = 0;

	while (queue.length) {
		assertActive();
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
		onProgress?.({ directory, scanned });
	}

	return uniqueRemoteEntries(files);
}
