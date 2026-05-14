import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
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
	isDirectoryLike,
	isDownloadableFile,
	joinPath,
	normalizeTarget,
	normalizePath,
	selectedEntries,
	selectionSummary,
	setVisibleSelection,
	toggleSelectedPath,
	transferPercent,
	updateTransferProgress,
	type RemoteEntry
} from './file-manager-state';

const entries: RemoteEntry[] = [
	{
		name: 'logs',
		path: '/var/logs',
		type: 'directory',
		size: 0,
		mtime: '2026-05-14T10:00:00.000Z'
	},
	{
		name: 'deploy.log',
		path: '/var/logs/deploy.log',
		type: 'file',
		size: 2048,
		mtime: '2026-05-14T10:01:00.000Z'
	},
	{
		name: 'current',
		path: '/var/www/current',
		type: 'symlink',
		size: 0,
		mtime: null,
		link: '/releases/42'
	}
];

describe('file manager state helpers', () => {
	it('normalizes and joins remote paths without parent traversal', () => {
		expect(normalizePath('/var//www/./current/')).toBe('/var/www/current');
		expect(normalizePath('/var/www/../log')).toBe('/var/log');
		expect(joinPath('/var/www/', '/index.html')).toBe('/var/www/index.html');
		expect(normalizeTarget('../logs/app.log', '/var/www/current')).toBe('/var/www/logs/app.log');
		expect(basename('/var/www/current/')).toBe('current');
		expect(dirname('/var/www/current/app.log')).toBe('/var/www/current');
	});

	it('filters by name, path, type, and symlink target metadata', () => {
		expect(filterRemoteEntries(entries, 'deploy')).toEqual([entries[1]]);
		expect(filterRemoteEntries(entries, 'symlink')).toEqual([entries[2]]);
		expect(filterRemoteEntries(entries, 'releases/42')).toEqual([entries[2]]);
	});

	it('tracks visible bulk selection independently of hidden selections', () => {
		const selected = toggleSelectedPath(['/outside'], '/var/logs', true);
		const summary = selectionSummary(entries.slice(0, 2), selected);

		expect(summary).toMatchObject({
			count: 2,
			visibleCount: 1,
			allVisible: false,
			someVisible: true
		});
		expect(setVisibleSelection(selected, entries.slice(0, 2), true)).toEqual([
			'/outside',
			'/var/logs',
			'/var/logs/deploy.log'
		]);
		expect(setVisibleSelection(selected, entries.slice(0, 2), false)).toEqual(['/outside']);
		expect(selectedEntries(entries, ['/var/logs/deploy.log', '/missing'])).toEqual([entries[1]]);
	});

	it('keeps file listing predicates and labels stable for protocol adapters', () => {
		expect(entries.map(entryTypeLabel)).toEqual(['Directory', 'File', 'Symlink']);
		expect(isDirectoryLike(entries[0])).toBe(true);
		expect(isDownloadableFile(entries[1])).toBe(true);
		expect(isDownloadableFile(entries[2])).toBe(false);
	});

	it('filters large remote listings within a coarse transform budget', () => {
		const largeListing = Array.from({ length: 2_000 }, (_, index): RemoteEntry => {
			const type = index % 5 === 0 ? 'directory' : 'file';
			return {
				name: type === 'directory' ? `release-${index}` : `artifact-${index}.log`,
				path: `/srv/releases/${index}`,
				type,
				size: index * 10,
				mtime: null,
				longname: `${type} deploy owner-${index % 7}`,
				user: `owner-${index % 7}`,
				group: index % 2 === 0 ? 'ops' : 'dev'
			};
		});

		const startedAt = performance.now();
		const filtered = filterRemoteEntries(largeListing, 'owner-3');
		const nextSelection = setVisibleSelection([], filtered, true);
		const elapsedMs = performance.now() - startedAt;

		expect(filtered.every((entry) => entry.user === 'owner-3')).toBe(true);
		expect(nextSelection).toEqual(filtered.map((entry) => entry.path).sort());
		expect(elapsedMs).toBeLessThan(250);
	});

	it('derives progress percentage, throughput, and remaining time', () => {
		const started = createTransferProgress({
			kind: 'upload',
			label: 'Upload',
			totalBytes: 1000,
			totalItems: 2,
			now: 1_000
		});
		const updated = updateTransferProgress(started, {
			completedBytes: 500,
			completedItems: 1,
			now: 2_000
		});

		expect(transferPercent(updated)).toBe(50);
		expect(updated.throughputBytesPerSecond).toBe(500);
		expect(updated.remainingMs).toBe(1000);
		expect(formatThroughput(updated.throughputBytesPerSecond)).toBe('500 B/s');
	});

	it('formats compact size and duration labels', () => {
		expect(formatSize(0)).toBe('0 B');
		expect(formatSize(1536)).toBe('1.5 KB');
		expect(formatDuration(65_000)).toBe('1m 5s');
	});

	it('enforces recursive upload aggregate limits while scanning entries', () => {
		let scan = createRecursiveUploadLimitState();

		for (let index = 0; index < fileTransferLimits.recursiveMaxEntries; index += 1) {
			scan = countRecursiveUploadEntry(scan);
		}

		expect(() => countRecursiveUploadEntry(scan)).toThrow('scanned entries');
	});

	it('enforces recursive upload file count and total bytes before transfer starts', () => {
		const tooManyFiles = Array.from({ length: fileTransferLimits.recursiveMaxFiles + 1 }, () => ({
			size: 1,
			directories: ['payload']
		}));
		const tooLarge = [
			{
				size: fileTransferLimits.recursiveMaxBytes + 1,
				directories: ['payload']
			}
		];
		const validScan = countRecursiveUploadFile(
			countRecursiveUploadEntry(createRecursiveUploadLimitState()),
			fileTransferLimits.recursiveMaxBytes
		);

		expect(validScan).toMatchObject({
			files: 1,
			scannedEntries: 1,
			totalBytes: fileTransferLimits.recursiveMaxBytes
		});
		expect(() => assertRecursiveUploadItemsWithinLimits(tooManyFiles)).toThrow('files');
		expect(() => assertRecursiveUploadItemsWithinLimits(tooLarge)).toThrow('total');
	});
});
