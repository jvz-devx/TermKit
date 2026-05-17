import { describe, expect, it } from 'vitest';
import { fileTransferLimits } from '../state/file-manager-state';
import { assertUploadItemsWithinLimits } from './sftp-transfer-operations';
import type { UploadItem } from './sftp-upload-drop';

function uploadItem(size: number, directories: string[] = []): UploadItem {
	return {
		file: new File(['x'.repeat(size)], 'upload.txt'),
		relativePath: 'upload.txt',
		directories
	};
}

describe('sftp transfer operations', () => {
	it('allows flat uploads without recursive limit checks', () => {
		expect(() =>
			assertUploadItemsWithinLimits([uploadItem(fileTransferLimits.uploadMaxBytes)])
		).not.toThrow();
	});

	it('enforces recursive upload file limits', () => {
		const items = Array.from({ length: fileTransferLimits.recursiveMaxFiles + 1 }, (_, index) =>
			uploadItem(1, [`folder-${index}`])
		);

		expect(() => assertUploadItemsWithinLimits(items)).toThrow('Recursive upload is limited');
	});
});
