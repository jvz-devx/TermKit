import {
	fileTransferLimits,
	filterRemoteEntries,
	type RemoteEntry
} from '../file-manager-state';

export type RemoteSearchProgress = {
	directory: string;
	scannedEntries: number;
};

export type RemoteSearchResult = {
	matches: RemoteEntry[];
	scannedEntries: number;
};

export async function searchRemoteEntries({
	rootPath,
	query,
	listDirectory,
	assertActive,
	onProgress
}: {
	rootPath: string;
	query: string;
	listDirectory: (path: string) => Promise<RemoteEntry[]>;
	assertActive: () => void;
	onProgress?: (progress: RemoteSearchProgress) => void;
}): Promise<RemoteSearchResult> {
	const matches: RemoteEntry[] = [];
	const queue = [rootPath];
	let scannedEntries = 0;
	let scannedDirectories = 0;

	while (queue.length) {
		assertActive();
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
		onProgress?.({ directory, scannedEntries });
		if (scannedEntries >= fileTransferLimits.remoteSearchMaxEntries) break;
	}

	return { matches, scannedEntries };
}
