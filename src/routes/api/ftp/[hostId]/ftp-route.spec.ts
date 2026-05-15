import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createFtpDirectory,
	deleteFtpPath,
	listFtpDirectory,
	openRecordedFtpDownload,
	readFtpTextFile,
	renameFtpPath,
	runRecordedFtpAction,
	writeFtpFile,
	writeFtpTextFile
} from '$lib/server/protocols/ftp';
import { DELETE as DELETE_PATH } from './delete/+server';
import { GET as DOWNLOAD } from './download/+server';
import { GET as LIST } from './list/+server';
import { POST as MKDIR } from './mkdir/+server';
import { POST as MOVE } from './move/+server';
import { POST as RENAME } from './rename/+server';
import { GET as READ_TEXT, PUT as WRITE_TEXT } from './text/+server';
import { POST as UPLOAD } from './upload/+server';

vi.mock('$lib/server/protocols/ftp', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/protocols/ftp')>();

	return {
		...actual,
		createFtpDirectory: vi.fn(),
		deleteFtpPath: vi.fn(),
		listFtpDirectory: vi.fn(),
		openRecordedFtpDownload: vi.fn(),
		readFtpTextFile: vi.fn(),
		renameFtpPath: vi.fn(),
		runRecordedFtpAction: vi.fn(),
		writeFtpFile: vi.fn(),
		writeFtpTextFile: vi.fn()
	};
});

describe('FTP API routes', () => {
	const target = {
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ftp',
		host: 'ftp.internal',
		port: 21,
		username: 'operator',
		password: 'redacted',
		secure: false,
		secureMode: 'plain'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(runRecordedFtpAction).mockImplementation(
			async (_userId, _hostId, _action, operation) => operation(target as never) as never
		);
		vi.mocked(createFtpDirectory).mockResolvedValue(undefined as never);
		vi.mocked(deleteFtpPath).mockResolvedValue(undefined as never);
		vi.mocked(listFtpDirectory).mockResolvedValue([] as never);
		vi.mocked(openRecordedFtpDownload).mockResolvedValue({
			path: '/srv/file.txt',
			body: streamFromText('downloaded'),
			done: Promise.resolve()
		} as never);
		vi.mocked(readFtpTextFile).mockResolvedValue('remote text' as never);
		vi.mocked(renameFtpPath).mockResolvedValue(undefined as never);
		vi.mocked(writeFtpFile).mockResolvedValue(undefined as never);
		vi.mocked(writeFtpTextFile).mockResolvedValue(undefined as never);
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
	])('rejects unauthenticated %s requests before recording FTP lifecycle', async (_name, call) => {
		const response = await call();

		expect(response.status).toBe(401);
		expect(runRecordedFtpAction).not.toHaveBeenCalled();
		expect(openRecordedFtpDownload).not.toHaveBeenCalled();
	});

	it('lists the root directory through the recorded FTP action wrapper', async () => {
		vi.mocked(listFtpDirectory).mockResolvedValueOnce([
			{
				name: 'logs',
				path: '/logs',
				type: 'directory',
				size: 0,
				mtime: '2026-05-15T00:00:00.000Z',
				rawModifiedAt: '2026-05-15T00:00:00.000Z',
				mode: null,
				link: null,
				user: null,
				group: null
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
					rawModifiedAt: '2026-05-15T00:00:00.000Z',
					mode: null,
					link: null,
					user: null,
					group: null
				}
			]
		});
		expect(runRecordedFtpAction).toHaveBeenCalledWith(
			'user-1',
			'host-1',
			'list',
			expect.any(Function),
			{ path: '/' }
		);
		expect(listFtpDirectory).toHaveBeenCalledWith(target, '/');
	});

	it('serializes FTPS TLS failures from the recorded action wrapper', async () => {
		vi.mocked(runRecordedFtpAction).mockRejectedValueOnce(
			Object.assign(new Error('FTPS certificate validation failed'), {
				status: 502,
				code: 'ftp_tls_certificate_invalid',
				category: 'tls',
				details: {
					action: 'list',
					path: '/',
					protocol: 'ftps',
					ftpsMode: 'explicit',
					nodeCode: 'DEPTH_ZERO_SELF_SIGNED_CERT'
				}
			}) as never
		);

		const response = await LIST(routeEvent());

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: 'FTPS certificate validation failed',
			code: 'ftp_tls_certificate_invalid',
			category: 'tls',
			details: {
				action: 'list',
				path: '/',
				protocol: 'ftps',
				ftpsMode: 'explicit',
				nodeCode: 'DEPTH_ZERO_SELF_SIGNED_CERT'
			}
		});
		expect(listFtpDirectory).not.toHaveBeenCalled();
	});

	it('rejects invalid download paths before opening a recorded stream', async () => {
		const response = await DOWNLOAD(routeEvent({ path: 'relative.txt' }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			issues: ['path must be absolute']
		});
		expect(openRecordedFtpDownload).not.toHaveBeenCalled();
	});

	it('streams recorded downloads with attachment headers', async () => {
		vi.mocked(openRecordedFtpDownload).mockResolvedValueOnce({
			path: '/srv/report 1.txt',
			body: streamFromText('ftp body'),
			done: Promise.resolve()
		} as never);

		const response = await DOWNLOAD(routeEvent({ path: '/srv/report 1.txt' }));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-disposition')).toBe(
			"attachment; filename*=UTF-8''report%201.txt"
		);
		await expect(response.text()).resolves.toBe('ftp body');
		expect(openRecordedFtpDownload).toHaveBeenCalledWith('user-1', 'host-1', '/srv/report 1.txt');
	});

	it('rejects mkdir requests without a path before recording the action', async () => {
		const response = await MKDIR(routeEvent({ method: 'POST', body: {} }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['path is required'] });
		expect(runRecordedFtpAction).not.toHaveBeenCalled();
		expect(createFtpDirectory).not.toHaveBeenCalled();
	});

	it('creates directories through the recorded action callback', async () => {
		const response = await MKDIR(routeEvent({ method: 'POST', body: { path: '/srv/new/' } }));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ path: '/srv/new' });
		expect(runRecordedFtpAction).toHaveBeenCalledWith(
			'user-1',
			'host-1',
			'mkdir',
			expect.any(Function),
			{ path: '/srv/new' }
		);
		expect(createFtpDirectory).toHaveBeenCalledWith(target, '/srv/new');
	});

	it('rejects rename requests without a source before recording the action', async () => {
		const response = await RENAME(routeEvent({ method: 'POST', body: { to: '/srv/b.txt' } }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['from is required'] });
		expect(runRecordedFtpAction).not.toHaveBeenCalled();
		expect(renameFtpPath).not.toHaveBeenCalled();
	});

	it('renames and moves paths with distinct lifecycle action names', async () => {
		const renameResponse = await RENAME(
			routeEvent({ method: 'POST', body: { from: '/srv/a.txt', to: '/srv/b.txt' } })
		);
		const moveResponse = await MOVE(
			routeEvent({ method: 'POST', body: { from: '/srv/c.txt', to: '/srv/d.txt' } })
		);

		expect(renameResponse.status).toBe(200);
		expect(moveResponse.status).toBe(200);
		expect(runRecordedFtpAction).toHaveBeenNthCalledWith(
			1,
			'user-1',
			'host-1',
			'rename',
			expect.any(Function),
			{ path: '/srv/a.txt' }
		);
		expect(runRecordedFtpAction).toHaveBeenNthCalledWith(
			2,
			'user-1',
			'host-1',
			'move',
			expect.any(Function),
			{ path: '/srv/c.txt' }
		);
		expect(renameFtpPath).toHaveBeenNthCalledWith(1, target, '/srv/a.txt', '/srv/b.txt');
		expect(renameFtpPath).toHaveBeenNthCalledWith(2, target, '/srv/c.txt', '/srv/d.txt');
	});

	it('serializes text-read failures from the recorded FTP action', async () => {
		vi.mocked(runRecordedFtpAction).mockRejectedValueOnce(
			Object.assign(new Error('FTP path not found'), {
				status: 404,
				code: 'ftp_path_not_found',
				category: 'not_found',
				details: { action: 'read_text', protocol: 'ftp' }
			}) as never
		);

		const response = await READ_TEXT(routeEvent({ path: '/srv/missing.txt' }));

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: 'FTP path not found',
			code: 'ftp_path_not_found',
			category: 'not_found',
			details: { action: 'read_text', protocol: 'ftp' }
		});
	});

	it('reads text files through the recorded action callback', async () => {
		const response = await READ_TEXT(routeEvent({ path: '/srv/file.txt' }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			path: '/srv/file.txt',
			text: 'remote text'
		});
		expect(runRecordedFtpAction).toHaveBeenCalledWith(
			'user-1',
			'host-1',
			'read_text',
			expect.any(Function),
			{ path: '/srv/file.txt' }
		);
		expect(readFtpTextFile).toHaveBeenCalledWith(target, '/srv/file.txt');
	});

	it('rejects write-text requests without text before recording the action', async () => {
		const response = await WRITE_TEXT(
			routeEvent({ method: 'PUT', body: { path: '/srv/file.txt' } })
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['text is required'] });
		expect(runRecordedFtpAction).not.toHaveBeenCalled();
		expect(writeFtpTextFile).not.toHaveBeenCalled();
	});

	it('writes text files through the recorded action callback', async () => {
		const response = await WRITE_TEXT(
			routeEvent({ method: 'PUT', body: { path: '/srv/file.txt', text: 'saved text' } })
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ path: '/srv/file.txt', size: 10 });
		expect(runRecordedFtpAction).toHaveBeenCalledWith(
			'user-1',
			'host-1',
			'write_text',
			expect.any(Function),
			{ path: '/srv/file.txt' }
		);
		expect(writeFtpTextFile).toHaveBeenCalledWith(target, '/srv/file.txt', 'saved text');
	});

	it('rejects uploads without a multipart file before recording the action', async () => {
		const response = await UPLOAD(uploadEvent({ path: '/srv/upload.txt', includeFile: false }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['file is required'] });
		expect(runRecordedFtpAction).not.toHaveBeenCalled();
		expect(writeFtpFile).not.toHaveBeenCalled();
	});

	it('uploads multipart files through the recorded action callback', async () => {
		const response = await UPLOAD(uploadEvent({ path: '/srv/upload.txt', contents: 'uploaded' }));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ path: '/srv/upload.txt', size: 8 });
		expect(runRecordedFtpAction).toHaveBeenCalledWith(
			'user-1',
			'host-1',
			'upload',
			expect.any(Function),
			{ path: '/srv/upload.txt' }
		);
		expect(writeFtpFile).toHaveBeenCalledWith(target, '/srv/upload.txt', Buffer.from('uploaded'));
	});

	it('deletes paths through the recorded action callback', async () => {
		const response = await DELETE_PATH(routeEvent({ method: 'DELETE', path: '/srv/file.txt' }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ path: '/srv/file.txt' });
		expect(runRecordedFtpAction).toHaveBeenCalledWith(
			'user-1',
			'host-1',
			'delete',
			expect.any(Function),
			{ path: '/srv/file.txt' }
		);
		expect(deleteFtpPath).toHaveBeenCalledWith(target, '/srv/file.txt');
	});

	it('serializes delete failures from the recorded FTP action', async () => {
		vi.mocked(runRecordedFtpAction).mockRejectedValueOnce(
			Object.assign(new Error('FTP permission denied'), {
				status: 403,
				code: 'ftp_permission_denied',
				category: 'authorization'
			}) as never
		);

		const response = await DELETE_PATH(routeEvent({ method: 'DELETE', path: '/srv/file.txt' }));

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: 'FTP permission denied',
			code: 'ftp_permission_denied',
			category: 'authorization'
		});
		expect(deleteFtpPath).not.toHaveBeenCalled();
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
	const url = new URL('https://termix.test/api/ftp/host-1/list');
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
}) {
	const url = new URL('https://termix.test/api/ftp/host-1/upload');
	url.searchParams.set('path', input.path);
	const form = new FormData();
	if (input.includeFile !== false) {
		form.set('file', new File([input.contents ?? 'file contents'], 'upload.txt'));
	}

	return {
		request: new Request(url, { method: 'POST', body: form }),
		params: { hostId: 'host-1' },
		url,
		locals: input.authenticated === false ? {} : { user: { id: 'user-1' } }
	} as Parameters<typeof UPLOAD>[0];
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});
}
