import { describe, expect, it, vi } from 'vitest';
import { collectRecursiveDownloadFiles } from './sftp-recursive-download';
import type { RemoteEntry } from '../file-manager-state';

describe('SFTP recursive download collection', () => {
	it('collects downloadable files from selected directories', async () => {
		const onProgress = vi.fn();
		const files = await collectRecursiveDownloadFiles({
			entries: [entry('/folder', 'directory')],
			assertActive: vi.fn(),
			onProgress,
			listDirectory: async (path) => {
				if (path === '/folder') return [entry('/folder/a.txt', 'file'), entry('/folder/sub', 'directory')];
				if (path === '/folder/sub') return [entry('/folder/sub/b.txt', 'file')];
				return [];
			}
		});

		expect(files.map((file) => file.path)).toEqual(['/folder/a.txt', '/folder/sub/b.txt']);
		expect(onProgress).toHaveBeenCalledWith({ directory: '/folder', scanned: 2 });
		expect(onProgress).toHaveBeenCalledWith({ directory: '/folder/sub', scanned: 3 });
	});
});

function entry(path: string, type: RemoteEntry['type']): RemoteEntry {
	return {
		name: path.split('/').pop() ?? path,
		path,
		type,
		size: 1,
		mtime: null
	};
}
