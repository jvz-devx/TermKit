import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { DELETE as DELETE_PATH } from '../../../routes/api/ftp/[hostId]/delete/+server';
import { GET as DOWNLOAD } from '../../../routes/api/ftp/[hostId]/download/+server';
import { GET as LIST } from '../../../routes/api/ftp/[hostId]/list/+server';
import { POST as MKDIR } from '../../../routes/api/ftp/[hostId]/mkdir/+server';
import { POST as MOVE } from '../../../routes/api/ftp/[hostId]/move/+server';
import { POST as RENAME } from '../../../routes/api/ftp/[hostId]/rename/+server';
import { GET as READ_TEXT, PUT as WRITE_TEXT } from '../../../routes/api/ftp/[hostId]/text/+server';
import { POST as UPLOAD } from '../../../routes/api/ftp/[hostId]/upload/+server';

describe('FTP route auth', () => {
	it.each([
		['list', LIST, new Request('http://localhost/api/ftp/host-1/list?path=/srv/app')],
		['download', DOWNLOAD, new Request('http://localhost/api/ftp/host-1/download?path=/tmp/file')],
		[
			'upload',
			UPLOAD,
			new Request('http://localhost/api/ftp/host-1/upload?path=/tmp/file', { method: 'POST' })
		],
		['mkdir', MKDIR, new Request('http://localhost/api/ftp/host-1/mkdir', { method: 'POST' })],
		['rename', RENAME, new Request('http://localhost/api/ftp/host-1/rename', { method: 'POST' })],
		['move', MOVE, new Request('http://localhost/api/ftp/host-1/move', { method: 'POST' })],
		[
			'delete',
			DELETE_PATH,
			new Request('http://localhost/api/ftp/host-1/delete?path=/tmp/file', { method: 'DELETE' })
		],
		['read text', READ_TEXT, new Request('http://localhost/api/ftp/host-1/text?path=/tmp/file')],
		[
			'write text',
			WRITE_TEXT,
			new Request('http://localhost/api/ftp/host-1/text', { method: 'PUT' })
		]
	])('returns 401 for unauthenticated %s requests', async (_name, handler, request) => {
		const response = await handler({
			locals: {},
			params: { hostId: 'host-1' },
			request,
			url: new URL(request.url)
		} as RequestEvent);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'Unauthenticated' });
	});
});
