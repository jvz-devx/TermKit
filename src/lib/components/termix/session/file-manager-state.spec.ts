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
const performanceIt = process.env.TERMIXKIT_PERFORMANCE_BUDGETS === '1' ? it : it.skip;

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

	it('filters large remote listings with one bounded selection transform', () => {
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

		const filtered = filterRemoteEntries(largeListing, 'owner-3');
		const nextSelection = setVisibleSelection([], filtered, true);

		expect(largeListing).toHaveLength(2_000);
		expect(filtered.every((entry) => entry.user === 'owner-3')).toBe(true);
		expect(nextSelection).toEqual(filtered.map((entry) => entry.path).sort());
		expect(nextSelection).toHaveLength(filtered.length);
		expect(new Set(nextSelection).size).toBe(nextSelection.length);
	});

	performanceIt('keeps representative selection and progress transforms within budget', () => {
		const budgetMs = 300;
		const iterations = 250;
		const largeListing = Array.from({ length: 1_500 }, (_, index): RemoteEntry => {
			const type = index % 6 === 0 ? 'directory' : 'file';
			return {
				name: type === 'directory' ? `release-${index}` : `artifact-${index}.log`,
				path: `/srv/workspaces/prod/${index}`,
				type,
				size: index * 1024,
				mtime: null
			};
		});
		let checksum = 0;

		const startedAt = performance.now();
		for (let index = 0; index < iterations; index += 1) {
			const selection = setVisibleSelection(['/srv/outside'], largeListing, true);
			const summary = selectionSummary(largeListing, selection);
			const selected = selectedEntries(largeListing, selection);
			const progress = updateTransferProgress(
				createTransferProgress({
					kind: 'download',
					label: 'Workspace export',
					totalBytes: 10_000_000,
					totalItems: largeListing.length,
					now: 1_000
				}),
				{
					completedBytes: 4_000_000,
					completedItems: 600,
					currentName: `artifact-${index}.log`,
					now: 2_000
				}
			);

			checksum += summary.visibleCount + selected.length + transferPercent(progress);
		}
		const elapsedMs = performance.now() - startedAt;

		expect(checksum).toBe(iterations * (1_500 + 1_500 + 40));
		expect(elapsedMs).toBeLessThan(budgetMs);
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

	it('finishes transfer progress at totals while cancellation preserves partial progress', () => {
		const running = updateTransferProgress(
			createTransferProgress({
				kind: 'download',
				label: 'Download',
				totalBytes: 4000,
				totalItems: 4,
				now: 1_000
			}),
			{
				completedBytes: 1000,
				completedItems: 1,
				currentName: 'artifact-1.tar',
				now: 2_000
			}
		);
		const cancelled = updateTransferProgress(running, { status: 'cancelled', now: 2_500 });
		const completed = updateTransferProgress(running, { status: 'complete', now: 3_000 });

		expect(cancelled).toMatchObject({
			status: 'cancelled',
			completedBytes: 1000,
			completedItems: 1,
			currentName: 'artifact-1.tar'
		});
		expect(transferPercent(cancelled)).toBe(25);
		expect(cancelled.remainingMs).toBeGreaterThan(0);
		expect(completed).toMatchObject({
			status: 'complete',
			completedBytes: 4000,
			completedItems: 4
		});
		expect(transferPercent(completed)).toBe(100);
		expect(completed.remainingMs).toBe(0);
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
