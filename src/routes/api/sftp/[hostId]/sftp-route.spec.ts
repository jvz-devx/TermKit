import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createSftpDirectory,
	deleteSftpPath,
	listSftpDirectory,
	readSftpFile,
	readSftpTextFile,
	renameSftpPath,
	resolveSftpTarget,
	writeSftpFile,
	writeSftpTextFile
} from '$lib/server/protocols/sftp';
import { multipartUploadBodyLimit, SFTP_UPLOAD_MAX_BYTES } from '../../_helpers';
import { DELETE as DELETE_PATH } from './delete/+server';
import { GET as DOWNLOAD } from './download/+server';
import { GET as LIST } from './list/+server';
import { POST as MKDIR } from './mkdir/+server';
import { POST as MOVE } from './move/+server';
import { POST as RENAME } from './rename/+server';
import { GET as READ_TEXT, PUT as WRITE_TEXT } from './text/+server';
import { POST as UPLOAD } from './upload/+server';

vi.mock('$lib/server/protocols/sftp', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/protocols/sftp')>();

	return {
		...actual,
		createSftpDirectory: vi.fn(),
		deleteSftpPath: vi.fn(),
		listSftpDirectory: vi.fn(),
		readSftpFile: vi.fn(),
		readSftpTextFile: vi.fn(),
		renameSftpPath: vi.fn(),
		resolveSftpTarget: vi.fn(),
		writeSftpFile: vi.fn(),
		writeSftpTextFile: vi.fn()
	};
});

describe('SFTP API routes', () => {
	const target = {
		userId: 'user-1',
		hostId: 'host-1',
		host: 'sftp.internal',
		port: 22,
		username: 'operator'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(resolveSftpTarget).mockResolvedValue(target as never);
		vi.mocked(createSftpDirectory).mockResolvedValue(undefined as never);
		vi.mocked(deleteSftpPath).mockResolvedValue(undefined as never);
		vi.mocked(listSftpDirectory).mockResolvedValue([] as never);
		vi.mocked(readSftpFile).mockResolvedValue(Buffer.from('downloaded') as never);
		vi.mocked(readSftpTextFile).mockResolvedValue('remote text' as never);
		vi.mocked(renameSftpPath).mockResolvedValue(undefined as never);
		vi.mocked(writeSftpFile).mockResolvedValue(undefined as never);
		vi.mocked(writeSftpTextFile).mockResolvedValue(undefined as never);
	});

	it.each([
		['list', () => LIST(routeEvent({ authenticated: false }))],
		['download', () => DOWNLOAD(routeEvent({ path: '/srv/file.txt', authenticated: false }))],
		[
			'mkdir',
			() => MKDIR(routeEvent({ method: 'POST', body: { path: '/srv/new' }, authenticated: false }))
		],
		[
			'rename',
			() =>
				RENAME(
					routeEvent({
						method: 'POST',
						body: { from: '/srv/a.txt', to: '/srv/b.txt' },
						authenticated: false
					})
				)
		],
		[
			'move',
			() =>
				MOVE(
					routeEvent({
						method: 'POST',
						body: { from: '/srv/a.txt', to: '/srv/b.txt' },
						authenticated: false
					})
				)
		],
		['read text', () => READ_TEXT(routeEvent({ path: '/srv/file.txt', authenticated: false }))],
		[
			'write text',
			() =>
				WRITE_TEXT(
					routeEvent({
						method: 'PUT',
						body: { path: '/srv/file.txt', text: 'saved' },
						authenticated: false
					})
				)
		],
		['upload', () => UPLOAD(uploadEvent({ path: '/srv/upload.txt', authenticated: false }))],
		[
			'delete',
			() =>
				DELETE_PATH(routeEvent({ method: 'DELETE', path: '/srv/file.txt', authenticated: false }))
		]
	])(
		'rejects unauthenticated %s requests before resolving the host target',
		async (_name, call) => {
			const response = await call();

			expect(response.status).toBe(401);
			expect(resolveSftpTarget).not.toHaveBeenCalled();
		}
	);

	it('lists the root directory by default for the signed-in user', async () => {
		vi.mocked(listSftpDirectory).mockResolvedValueOnce([
			{
				name: 'logs',
				path: '/logs',
				type: 'directory',
				size: 0,
				mtime: '2026-05-15T00:00:00.000Z',
				mode: 16877,
				longname: 'drwxr-xr-x logs'
			}
		] as never);

		const response = await LIST(routeEvent());

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			path: '/',
			entries: [
				{
					name: 'logs',
					path: '/logs',
					type: 'directory',
					size: 0,
					mtime: '2026-05-15T00:00:00.000Z',
					mode: 16877,
					longname: 'drwxr-xr-x logs'
				}
			]
		});
		expect(resolveSftpTarget).toHaveBeenCalledWith('user-1', 'host-1');
		expect(listSftpDirectory).toHaveBeenCalledWith(target, '/');
	});

	it('rejects invalid download paths before opening SFTP connections', async () => {
		const response = await DOWNLOAD(routeEvent({ path: '../secret.txt' }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			issues: ['path must be absolute']
		});
		expect(resolveSftpTarget).not.toHaveBeenCalled();
		expect(readSftpFile).not.toHaveBeenCalled();
	});

	it('streams downloads with deterministic attachment headers', async () => {
		vi.mocked(readSftpFile).mockResolvedValueOnce(Buffer.from('download body') as never);

		const response = await DOWNLOAD(routeEvent({ path: '/srv/report 1.txt' }));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-length')).toBe('13');
		expect(response.headers.get('content-disposition')).toBe(
			"attachment; filename*=UTF-8''report%201.txt"
		);
		await expect(response.text()).resolves.toBe('download body');
		expect(readSftpFile).toHaveBeenCalledWith(target, '/srv/report 1.txt');
	});

	it('rejects write-text requests without a text payload before connecting', async () => {
		const response = await WRITE_TEXT(
			routeEvent({ method: 'PUT', body: { path: '/srv/file.txt' } })
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['text is required'] });
		expect(resolveSftpTarget).not.toHaveBeenCalled();
		expect(writeSftpTextFile).not.toHaveBeenCalled();
	});

	it('writes text files and returns the persisted byte size', async () => {
		const response = await WRITE_TEXT(
			routeEvent({ method: 'PUT', body: { path: '/srv/file.txt', text: 'saved text' } })
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ path: '/srv/file.txt', size: 10 });
		expect(writeSftpTextFile).toHaveBeenCalledWith(target, '/srv/file.txt', 'saved text');
	});

	it('rejects rename requests with missing destinations before connecting', async () => {
		const response = await RENAME(routeEvent({ method: 'POST', body: { from: '/srv/a.txt' } }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['to is required'] });
		expect(resolveSftpTarget).not.toHaveBeenCalled();
		expect(renameSftpPath).not.toHaveBeenCalled();
	});

	it('reads text files from the requested path', async () => {
		const response = await READ_TEXT(routeEvent({ path: '/srv/file.txt' }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			path: '/srv/file.txt',
			text: 'remote text'
		});
		expect(readSftpTextFile).toHaveBeenCalledWith(target, '/srv/file.txt');
	});

	it('moves paths through the rename route compatibility export', async () => {
		const response = await MOVE(
			routeEvent({ method: 'POST', body: { from: '/srv/a.txt', to: '/srv/b.txt' } })
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ from: '/srv/a.txt', to: '/srv/b.txt' });
		expect(renameSftpPath).toHaveBeenCalledWith(target, '/srv/a.txt', '/srv/b.txt');
	});

	it('creates directories with normalized absolute paths', async () => {
		const response = await MKDIR(routeEvent({ method: 'POST', body: { path: '/srv/new/' } }));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ path: '/srv/new' });
		expect(createSftpDirectory).toHaveBeenCalledWith(target, '/srv/new');
	});

	it('rejects uploads without a multipart file before connecting', async () => {
		const response = await UPLOAD(uploadEvent({ path: '/srv/upload.txt', includeFile: false }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['file is required'] });
		expect(resolveSftpTarget).not.toHaveBeenCalled();
		expect(writeSftpFile).not.toHaveBeenCalled();
	});

	it('rejects honest oversized upload bodies before connecting', async () => {
		const response = await UPLOAD(
			uploadEvent({
				path: '/srv/upload.txt',
				contentLength: multipartUploadBodyLimit(SFTP_UPLOAD_MAX_BYTES) + 1
			})
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toMatchObject({
			error: 'request exceeds the 50 MiB upload limit'
		});
		expect(resolveSftpTarget).not.toHaveBeenCalled();
		expect(writeSftpFile).not.toHaveBeenCalled();
	});

	it('rejects invalid upload content-length before connecting', async () => {
		const response = await UPLOAD(
			uploadEvent({ path: '/srv/upload.txt', contentLength: 'invalid' })
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			issues: ['content-length must be a non-negative integer']
		});
		expect(resolveSftpTarget).not.toHaveBeenCalled();
		expect(writeSftpFile).not.toHaveBeenCalled();
	});

	it('uploads multipart files as buffers', async () => {
		const response = await UPLOAD(uploadEvent({ path: '/srv/upload.txt', contents: 'uploaded' }));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ path: '/srv/upload.txt', size: 8 });
		expect(writeSftpFile).toHaveBeenCalledWith(target, '/srv/upload.txt', Buffer.from('uploaded'));
	});

	it('serializes delete failures from the SFTP protocol layer', async () => {
		vi.mocked(deleteSftpPath).mockRejectedValueOnce(
			Object.assign(new Error('permission denied'), {
				status: 403,
				code: 'sftp_permission_denied',
				category: 'authorization'
			}) as never
		);

		const response = await DELETE_PATH(routeEvent({ method: 'DELETE', path: '/srv/file.txt' }));

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: 'permission denied',
			code: 'sftp_permission_denied',
			category: 'authorization'
		});
		expect(deleteSftpPath).toHaveBeenCalledWith(target, '/srv/file.txt');
	});

	it('serializes policy-blocked SFTP routes before file operations run', async () => {
		vi.mocked(resolveSftpTarget).mockRejectedValueOnce(
			Object.assign(new Error('Transfer files is disabled by workspace policy.'), {
				status: 403,
				code: 'policy_action_disabled',
				category: 'authorization',
				details: { action: 'transfer', state: 'blocked', protocol: 'sftp' }
			}) as never
		);

		const response = await LIST(routeEvent({ path: '/srv' }));

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: 'Transfer files is disabled by workspace policy.',
			code: 'policy_action_disabled',
			category: 'authorization',
			details: { action: 'transfer', state: 'blocked', protocol: 'sftp' }
		});
		expect(listSftpDirectory).not.toHaveBeenCalled();
	});
});

function routeEvent(
	input: {
		method?: string;
		path?: string;
		body?: Record<string, unknown>;
		authenticated?: boolean;
	} = {}
) {
	const url = new URL('https://termix.test/api/sftp/host-1/list');
	if (input.path !== undefined) url.searchParams.set('path', input.path);

	return {
		request: new Request(url, {
			method: input.method ?? 'GET',
			body: input.body ? JSON.stringify(input.body) : undefined,
			headers: input.body ? { 'content-type': 'application/json' } : undefined
		}),
		params: { hostId: 'host-1' },
		url,
		locals: input.authenticated === false ? {} : { user: { id: 'user-1' } }
	} as Parameters<typeof LIST>[0];
}

function uploadEvent(input: {
	path: string;
	contents?: string;
	includeFile?: boolean;
	authenticated?: boolean;
	contentLength?: number | string;
}) {
	const url = new URL('https://termix.test/api/sftp/host-1/upload');
	url.searchParams.set('path', input.path);
	const form = new FormData();
	if (input.includeFile !== false) {
		form.set('file', new File([input.contents ?? 'file contents'], 'upload.txt'));
	}

	return {
		request: new Request(url, {
			method: 'POST',
			body: form,
			headers:
				input.contentLength === undefined
					? undefined
					: { 'content-length': String(input.contentLength) }
		}),
		params: { hostId: 'host-1' },
		url,
		locals: input.authenticated === false ? {} : { user: { id: 'user-1' } }
	} as Parameters<typeof UPLOAD>[0];
}
