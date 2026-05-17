import {
	fileTransferLimits,
	formatSize,
	joinPath,
	minimalRemoteEntries,
	normalizeTarget,
	orderedRemoteEntriesForDelete,
	selectedEntries,
	type RemoteEntry
} from '../state/file-manager-state';
import type { UploadItem } from '../transfers/sftp-upload-drop';

export type PendingRecursive =
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

export type UploadQueuePlan =
	| { kind: 'empty' }
	| { kind: 'error'; message: string }
	| { kind: 'upload'; items: UploadItem[] }
	| { kind: 'recursive'; pending: Extract<PendingRecursive, { kind: 'upload' }> };

export function actionEntries(selectedEntryList: RemoteEntry[], selected: RemoteEntry | null) {
	return minimalRemoteEntries(
		selectedEntryList.length ? selectedEntryList : selected ? [selected] : []
	);
}

export function deleteEntriesForSelection({
	entries,
	selectedPaths,
	selected
}: {
	entries: RemoteEntry[];
	selectedPaths: string[];
	selected: RemoteEntry | null;
}) {
	const explicitEntries = selectedEntries(entries, selectedPaths);
	return orderedRemoteEntriesForDelete(
		explicitEntries.length ? explicitEntries : selected ? [selected] : []
	);
}

export function uploadQueuePlan(items: UploadItem[]): UploadQueuePlan {
	if (!items.length) return { kind: 'empty' };

	const oversized = items.find((item) => item.file.size > fileTransferLimits.uploadMaxBytes);
	if (oversized) {
		return {
			kind: 'error',
			message: `${oversized.relativePath} exceeds the ${formatSize(fileTransferLimits.uploadMaxBytes)} upload limit`
		};
	}

	const totalBytes = items.reduce((total, item) => total + item.file.size, 0);
	const directories = uploadDirectoryPaths(items);
	if (!directories.length) return { kind: 'upload', items };

	return {
		kind: 'recursive',
		pending: {
			kind: 'upload',
			items,
			directoryCount: directories.length,
			totalBytes
		}
	};
}

export function uploadDirectoryPaths(items: UploadItem[]) {
	return [...new Set(items.flatMap((item) => item.directories))].sort(
		(left, right) => left.split('/').length - right.split('/').length
	);
}

export function recursiveUploadLimitItems(items: UploadItem[]) {
	return items.map((item) => ({
		size: item.file.size,
		directories: item.directories
	}));
}

export function moveTargetForEntry({
	entry,
	entriesToMove,
	target,
	currentPath
}: {
	entry: RemoteEntry;
	entriesToMove: RemoteEntry[];
	target: string;
	currentPath: string;
}) {
	return entriesToMove.length === 1
		? normalizeTarget(target, currentPath)
		: joinPath(normalizeTarget(target, currentPath), entry.name);
}

export function transferItemLabel(action: string, count: number, singular = 'item') {
	return `${action} ${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function isAbortError(caught: unknown) {
	return caught instanceof DOMException && caught.name === 'AbortError';
}
