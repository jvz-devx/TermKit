import { describe, expect, it } from 'vitest';
import { droppedUploadItems } from './sftp-upload-drop';

describe('SFTP dropped upload item parsing', () => {
	it('uses DataTransfer files when no item entries are available', async () => {
		const file = new File(['hello'], 'hello.txt');

		const items = await droppedUploadItems({
			items: [],
			files: [file]
		} as unknown as DataTransfer);

		expect(items).toEqual([{ file, relativePath: 'hello.txt', directories: [] }]);
	});

	it('preserves recursive directory paths from webkit entries', async () => {
		const file = new File(['nested'], 'file.txt');
		const fileEntry = {
			name: 'file.txt',
			fullPath: '/folder/subdir/file.txt',
			isFile: true,
			isDirectory: false,
			file: (success: (file: File) => void) => success(file)
		};
		const subdirEntry = directoryEntry('subdir', '/folder/subdir', [fileEntry]);
		const folderEntry = directoryEntry('folder', '/folder', [subdirEntry]);

		const items = await droppedUploadItems({
			items: [{ webkitGetAsEntry: () => folderEntry }],
			files: []
		} as unknown as DataTransfer);

		expect(items).toEqual([
			{
				file,
				relativePath: 'folder/subdir/file.txt',
				directories: ['folder', 'folder/subdir']
			}
		]);
	});
});

function directoryEntry(name: string, fullPath: string, children: unknown[]) {
	let read = false;
	return {
		name,
		fullPath,
		isFile: false,
		isDirectory: true,
		createReader: () => ({
			readEntries: (success: (entries: unknown[]) => void) => {
				if (read) {
					success([]);
					return;
				}
				read = true;
				success(children);
			}
		})
	};
}
