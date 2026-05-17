export type RemoteEntryType = 'directory' | 'file' | 'symlink' | 'other';

export type RemoteEntry = {
	name: string;
	path: string;
	type: RemoteEntryType;
	size: number;
	mtime: string | null;
	mode?: number | null;
	longname?: string | null;
	link?: string | null;
	rawModifiedAt?: string | null;
	user?: string | null;
	group?: string | null;
};

export type TransferProgress = {
	kind: 'upload' | 'download' | 'delete' | 'move' | 'search';
	label: string;
	status: 'running' | 'complete' | 'cancelled' | 'failed';
	startedAt: number;
	updatedAt: number;
	totalBytes: number;
	completedBytes: number;
	totalItems: number;
	completedItems: number;
	currentName: string | null;
	throughputBytesPerSecond: number;
	remainingMs: number | null;
};

export const fileTransferLimits = {
	uploadMaxBytes: 50 * 1024 * 1024,
	recursiveMaxBytes: 500 * 1024 * 1024,
	recursiveMaxFiles: 200,
	recursiveMaxEntries: 1000,
	remoteSearchMaxDirectories: 50,
	remoteSearchMaxEntries: 1000
} as const;

export type RecursiveUploadLimitState = {
	files: number;
	scannedEntries: number;
	totalBytes: number;
};

export type RecursiveUploadLimitItem = {
	size: number;
	directories?: readonly string[];
};

export function createRecursiveUploadLimitState(): RecursiveUploadLimitState {
	return {
		files: 0,
		scannedEntries: 0,
		totalBytes: 0
	};
}

export function countRecursiveUploadEntry(
	state: RecursiveUploadLimitState
): RecursiveUploadLimitState {
	const next = {
		...state,
		scannedEntries: state.scannedEntries + 1
	};
	assertRecursiveUploadLimits(next);
	return next;
}

export function countRecursiveUploadFile(
	state: RecursiveUploadLimitState,
	size: number
): RecursiveUploadLimitState {
	const next = {
		...state,
		files: state.files + 1,
		totalBytes: state.totalBytes + Math.max(0, size)
	};
	assertRecursiveUploadLimits(next);
	return next;
}

export function recursiveUploadItemSummary(
	items: readonly RecursiveUploadLimitItem[]
): RecursiveUploadLimitState {
	const directories = new Set<string>();
	let totalBytes = 0;

	for (const item of items) {
		totalBytes += Math.max(0, item.size);
		for (const directory of item.directories ?? []) directories.add(directory);
	}

	return {
		files: items.length,
		scannedEntries: items.length + directories.size,
		totalBytes
	};
}

export function assertRecursiveUploadItemsWithinLimits(
	items: readonly RecursiveUploadLimitItem[]
): void {
	assertRecursiveUploadLimits(recursiveUploadItemSummary(items));
}

export function assertRecursiveUploadLimits(state: RecursiveUploadLimitState): void {
	if (state.scannedEntries > fileTransferLimits.recursiveMaxEntries) {
		throw new Error(
			`Recursive upload is limited to ${fileTransferLimits.recursiveMaxEntries} scanned entries`
		);
	}
	if (state.files > fileTransferLimits.recursiveMaxFiles) {
		throw new Error(`Recursive upload is limited to ${fileTransferLimits.recursiveMaxFiles} files`);
	}
	if (state.totalBytes > fileTransferLimits.recursiveMaxBytes) {
		throw new Error(
			`Recursive upload is limited to ${formatSize(fileTransferLimits.recursiveMaxBytes)} total`
		);
	}
}

export function formatSize(size: number): string {
	if (!Number.isFinite(size) || size <= 0) return '0 B';
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
	if (size < 1024 * 1024 * 1024) return `${Math.round(size / 1024 / 102.4) / 10} MB`;
	return `${Math.round(size / 1024 / 1024 / 102.4) / 10} GB`;
}

export function formatThroughput(bytesPerSecond: number): string {
	if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s';
	return `${formatSize(Math.round(bytesPerSecond))}/s`;
}

export function formatDuration(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms) || ms < 0) return '-';
	const seconds = Math.ceil(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function parentPath(path: string): string {
	const normalized = normalizePath(path);
	if (normalized === '/') return '/';
	const parent = normalized.replace(/\/$/, '').split('/').slice(0, -1).join('/');
	return parent || '/';
}

export function joinPath(directory: string, name: string): string {
	const cleanName = name.replace(/^\/+/, '');
	if (!cleanName) return normalizePath(directory);
	return `${normalizePath(directory).replace(/\/$/, '')}/${cleanName}`.replace(/^\/\//, '/');
}

export function basename(path: string): string {
	return normalizePath(path).split('/').filter(Boolean).pop() ?? '/';
}

export function dirname(path: string): string {
	return parentPath(path);
}

export function normalizePath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed || trimmed === '/') return '/';
	const withRoot = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	const parts: string[] = [];
	for (const part of withRoot.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `/${parts.join('/')}`.replace(/\/$/, '') || '/';
}

export function normalizeTarget(value: string, currentPath: string): string {
	return normalizePath(value.startsWith('/') ? value : joinPath(currentPath, value));
}

export function isDirectoryLike(entry: RemoteEntry): boolean {
	return entry.type === 'directory';
}

export function isDownloadableFile(entry: RemoteEntry): boolean {
	return entry.type === 'file';
}

export function entryTypeLabel(entry: RemoteEntry): string {
	if (entry.type === 'symlink') return 'Symlink';
	if (entry.type === 'directory') return 'Directory';
	if (entry.type === 'file') return 'File';
	return 'Other';
}

export function filterRemoteEntries(entries: RemoteEntry[], query: string): RemoteEntry[] {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return entries;

	return entries.filter((entry) => {
		const haystack = [
			entry.name,
			entry.path,
			entry.type,
			entry.link ?? '',
			entry.longname ?? '',
			entry.user ?? '',
			entry.group ?? ''
		]
			.join(' ')
			.toLocaleLowerCase();
		return haystack.includes(needle);
	});
}

export function selectionSummary(entries: RemoteEntry[], selectedPaths: string[]) {
	const visiblePaths = new Set(entries.map((entry) => entry.path));
	const visibleSelected = selectedPaths.filter((path) => visiblePaths.has(path));
	return {
		count: selectedPaths.length,
		visibleCount: visibleSelected.length,
		allVisible: entries.length > 0 && visibleSelected.length === entries.length,
		someVisible: visibleSelected.length > 0 && visibleSelected.length < entries.length
	};
}

export function toggleSelectedPath(
	selectedPaths: string[],
	path: string,
	selected: boolean
): string[] {
	const current = new Set(selectedPaths);
	if (selected) current.add(path);
	else current.delete(path);
	return [...current].sort();
}

export function setVisibleSelection(
	selectedPaths: string[],
	entries: RemoteEntry[],
	selected: boolean
): string[] {
	const current = new Set(selectedPaths);
	for (const entry of entries) {
		if (selected) current.add(entry.path);
		else current.delete(entry.path);
	}
	return [...current].sort();
}

export function selectedEntries(entries: RemoteEntry[], selectedPaths: string[]): RemoteEntry[] {
	const selected = new Set(selectedPaths);
	return entries.filter((entry) => selected.has(entry.path));
}

export function minimalRemoteEntries(entriesToCollapse: RemoteEntry[]): RemoteEntry[] {
	const uniqueEntries = uniqueRemoteEntries(entriesToCollapse).sort((left, right) => {
		const leftPath = normalizePath(left.path);
		const rightPath = normalizePath(right.path);
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

export function uniqueRemoteEntries(entriesToDedupe: RemoteEntry[]): RemoteEntry[] {
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

export function isDescendantPath(pathToCheck: string, ancestorPath: string): boolean {
	const pathWithSlash = `${normalizePath(pathToCheck)}/`;
	const ancestorWithSlash = `${normalizePath(ancestorPath).replace(/\/$/, '')}/`;
	return pathWithSlash.startsWith(ancestorWithSlash) && pathWithSlash !== ancestorWithSlash;
}

export function orderedRemoteEntriesForDelete(entries: RemoteEntry[]): RemoteEntry[] {
	const uniqueByPath = new Map<string, RemoteEntry>();

	for (const entry of entries) {
		const normalized = normalizePath(entry.path);
		if (!uniqueByPath.has(normalized)) uniqueByPath.set(normalized, entry);
	}

	return [...uniqueByPath.values()].sort((left, right) => {
		const leftPath = normalizePath(left.path);
		const rightPath = normalizePath(right.path);
		const leftDepth = remotePathDepth(leftPath);
		const rightDepth = remotePathDepth(rightPath);
		if (leftDepth !== rightDepth) return rightDepth - leftDepth;
		return leftPath.localeCompare(rightPath);
	});
}

function remotePathDepth(path: string): number {
	return normalizePath(path).split('/').filter(Boolean).length;
}

export function createTransferProgress(input: {
	kind: TransferProgress['kind'];
	label: string;
	totalBytes?: number;
	totalItems?: number;
	currentName?: string | null;
	now?: number;
}): TransferProgress {
	const now = input.now ?? Date.now();
	return {
		kind: input.kind,
		label: input.label,
		status: 'running',
		startedAt: now,
		updatedAt: now,
		totalBytes: Math.max(0, input.totalBytes ?? 0),
		completedBytes: 0,
		totalItems: Math.max(0, input.totalItems ?? 0),
		completedItems: 0,
		currentName: input.currentName ?? null,
		throughputBytesPerSecond: 0,
		remainingMs: null
	};
}

export function updateTransferProgress(
	progress: TransferProgress,
	update: Partial<
		Pick<
			TransferProgress,
			| 'completedBytes'
			| 'completedItems'
			| 'currentName'
			| 'label'
			| 'status'
			| 'totalBytes'
			| 'totalItems'
		>
	> & { now?: number }
): TransferProgress {
	const now = update.now ?? Date.now();
	const status = update.status ?? progress.status;
	const totalBytes = Math.max(0, update.totalBytes ?? progress.totalBytes);
	const totalItems = Math.max(0, update.totalItems ?? progress.totalItems);
	let completedBytes = Math.max(0, update.completedBytes ?? progress.completedBytes);
	let completedItems = Math.max(0, update.completedItems ?? progress.completedItems);

	if (status === 'complete') {
		if (update.completedBytes === undefined && totalBytes > 0) completedBytes = totalBytes;
		if (update.completedItems === undefined && totalItems > 0) completedItems = totalItems;
	}

	const elapsedSeconds = Math.max((now - progress.startedAt) / 1000, 0);
	const throughputBytesPerSecond = elapsedSeconds > 0 ? completedBytes / elapsedSeconds : 0;
	const remainingBytes = totalBytes > completedBytes ? totalBytes - completedBytes : 0;
	const remainingMs =
		totalBytes > 0 && throughputBytesPerSecond > 0
			? (remainingBytes / throughputBytesPerSecond) * 1000
			: null;

	return {
		...progress,
		...update,
		updatedAt: now,
		totalBytes,
		completedBytes,
		completedItems,
		totalItems,
		status,
		throughputBytesPerSecond,
		remainingMs
	};
}

export function transferPercent(progress: TransferProgress): number {
	if (progress.totalBytes > 0) {
		return Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100));
	}
	if (progress.totalItems > 0) {
		return Math.min(100, Math.round((progress.completedItems / progress.totalItems) * 100));
	}
	return progress.status === 'complete' ? 100 : 0;
}
