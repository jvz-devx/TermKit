import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSftpClient } from './sftp-client';

describe('SFTP API client', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('builds encoded host and route URLs', () => {
		const client = createSftpClient('sftp', 'host/id');

		expect(client.url('/list?path=%2F')).toBe('/api/sftp/host%2Fid/list?path=%2F');
		expect(client.uploadUrl('/tmp/file.txt')).toBe(
			'/api/sftp/host%2Fid/upload?path=%2Ftmp%2Ffile.txt'
		);
	});

	it('lists remote entries with normalized fallback path', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							entries: [{ name: 'a', path: '/a', type: 'file', size: 1, mtime: null }]
						})
					)
			)
		);

		const result = await createSftpClient('sftp', 'host').list('/tmp/../tmp');

		expect(result.path).toBe('/tmp');
		expect(result.entries).toHaveLength(1);
	});

	it('returns false for ignored failed mutations', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"error":"no"}', { status: 409 }))
		);

		await expect(
			createSftpClient('ftp', 'host').request(
				'/mkdir',
				{ method: 'POST' },
				'Could not create',
				undefined,
				true
			)
		).resolves.toBe(false);
	});
});
