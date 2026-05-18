import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSftpClient } from './sftp-client';

describe('SFTP API client', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('builds encoded host and route URLs', () => {
		const client = createSftpClient('sftp', 'host/id');

		expect(client.url('/list?path=%2F')).toBe('/api/sftp/host%2Fid/list?path=%2F');
		expect(
			client.downloadUrl({ name: 'a', path: '/tmp/a.txt', type: 'file', size: 1, mtime: null })
		).toBe('/api/sftp/host%2Fid/download?path=%2Ftmp%2Fa.txt');
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

	it('uses API-provided list paths when present', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ path: '/resolved', entries: [] })))
		);

		const result = await createSftpClient('sftp', 'host').list('/tmp');

		expect(result.path).toBe('/resolved');
		expect(fetch).toHaveBeenCalledWith('/api/sftp/host/list?path=%2Ftmp', {
			signal: undefined
		});
	});

	it('throws API errors for failed lists and mutations', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"error":"Denied"}', { status: 403 }))
		);

		const client = createSftpClient('ftp', 'host');

		await expect(client.list('/tmp')).rejects.toThrow('Denied');
		await expect(client.request('/mkdir', { method: 'POST' }, 'Could not create')).rejects.toThrow(
			'Denied'
		);
	});

	it('reads text content and falls back to an empty string', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ content: 'hello' })))
				.mockResolvedValueOnce(new Response(JSON.stringify({ content: 123 })))
		);

		const client = createSftpClient('sftp', 'host');

		await expect(
			client.readText({ name: 'a.txt', path: '/a.txt', type: 'file', size: 5, mtime: null })
		).resolves.toBe('hello');
		await expect(
			client.readText({ name: 'b.txt', path: '/b.txt', type: 'file', size: 5, mtime: null })
		).resolves.toBe('');
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
