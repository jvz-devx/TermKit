import { describe, expect, it } from 'vitest';
import type { RemoteEntry } from './file-manager-state';
import {
	actionEntries,
	deleteEntriesForSelection,
	moveTargetForEntry,
	transferItemLabel,
	uploadDirectoryPaths,
	uploadQueuePlan
} from './sftp-browser-actions';

function entry(path: string, type: RemoteEntry['type'] = 'file'): RemoteEntry {
	return {
		name: path.split('/').filter(Boolean).pop() ?? '/',
		path,
		type,
		size: 1,
		mtime: null
	};
}

function uploadItem(relativePath: string, directories: string[] = [], size = 1) {
	return {
		file: { size } as File,
		relativePath,
		directories
	};
}

describe('SFTP browser action helpers', () => {
	it('collapses selected entries to minimal action entries', () => {
		const parent = entry('/workspace', 'directory');
		const child = entry('/workspace/readme.md');

		expect(actionEntries([child, parent], null)).toEqual([parent]);
		expect(actionEntries([], child)).toEqual([child]);
	});

	it('orders delete entries from explicit paths or selected fallback', () => {
		const parent = entry('/workspace', 'directory');
		const child = entry('/workspace/readme.md');

		expect(
			deleteEntriesForSelection({
				entries: [parent, child],
				selectedPaths: [parent.path, child.path],
				selected: null
			})
		).toEqual([child, parent]);

		expect(
			deleteEntriesForSelection({
				entries: [parent, child],
				selectedPaths: [],
				selected: parent
			})
		).toEqual([parent]);
	});

	it('plans plain, recursive, empty, and oversized uploads', () => {
		expect(uploadQueuePlan([])).toEqual({ kind: 'empty' });
		expect(uploadQueuePlan([uploadItem('plain.txt')])).toMatchObject({ kind: 'upload' });

		const recursive = uploadQueuePlan([uploadItem('nested/plain.txt', ['nested'], 12)]);
		expect(recursive).toMatchObject({
			kind: 'recursive',
			pending: {
				kind: 'upload',
				directoryCount: 1,
				totalBytes: 12
			}
		});

		const oversized = uploadQueuePlan([uploadItem('large.bin', [], 50 * 1024 * 1024 + 1)]);
		expect(oversized).toMatchObject({
			kind: 'error',
			message: 'large.bin exceeds the 50 MB upload limit'
		});
	});

	it('sorts upload directories by depth before creation', () => {
		expect(
			uploadDirectoryPaths([uploadItem('a/b/c.txt', ['a/b', 'a']), uploadItem('a/d.txt', ['a'])])
		).toEqual(['a', 'a/b']);
	});

	it('normalizes move targets for single and multi-entry moves', () => {
		const first = entry('/workspace/one.txt');
		const second = entry('/workspace/two.txt');

		expect(
			moveTargetForEntry({
				entry: first,
				entriesToMove: [first],
				target: 'renamed.txt',
				currentPath: '/workspace'
			})
		).toBe('/workspace/renamed.txt');

		expect(
			moveTargetForEntry({
				entry: second,
				entriesToMove: [first, second],
				target: '/archive',
				currentPath: '/workspace'
			})
		).toBe('/archive/two.txt');
	});

	it('formats transfer labels with singular and plural nouns', () => {
		expect(transferItemLabel('Deleting', 1)).toBe('Deleting 1 item');
		expect(transferItemLabel('Downloading', 2, 'file')).toBe('Downloading 2 files');
	});
});
