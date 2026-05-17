import { describe, expect, it, vi } from 'vitest';
import { searchRemoteEntries } from './sftp-remote-search';
import type { RemoteEntry } from './file-manager-state';

describe('SFTP remote search', () => {
	it('walks directories and reports matching entries', async () => {
		const onProgress = vi.fn();
		const result = await searchRemoteEntries({
			rootPath: '/',
			query: 'target',
			assertActive: vi.fn(),
			onProgress,
			listDirectory: async (path) => {
				if (path === '/') return [entry('/target.txt', 'file'), entry('/folder', 'directory')];
				if (path === '/folder') return [entry('/folder/nested-target.log', 'file')];
				return [];
			}
		});

		expect(result.matches.map((match) => match.path)).toEqual([
			'/target.txt',
			'/folder/nested-target.log'
		]);
		expect(result.scannedEntries).toBe(3);
		expect(onProgress).toHaveBeenCalledWith({ directory: '/', scannedEntries: 2 });
		expect(onProgress).toHaveBeenCalledWith({ directory: '/folder', scannedEntries: 3 });
	});
});

function entry(path: string, type: RemoteEntry['type']): RemoteEntry {
	return {
		name: path.split('/').pop() ?? path,
		path,
		type,
		size: 0,
		mtime: null
	};
}
