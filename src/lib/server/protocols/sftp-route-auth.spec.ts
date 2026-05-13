import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { GET } from '../../../routes/api/sftp/[hostId]/list/+server';
import { POST as MKDIR } from '../../../routes/api/sftp/[hostId]/mkdir/+server';
import { POST as RENAME } from '../../../routes/api/sftp/[hostId]/rename/+server';
import { DELETE as DELETE_PATH } from '../../../routes/api/sftp/[hostId]/delete/+server';
import {
	GET as READ_TEXT,
	PUT as WRITE_TEXT
} from '../../../routes/api/sftp/[hostId]/text/+server';

describe('SFTP list route auth', () => {
	it('returns 401 before resolving SFTP target when unauthenticated', async () => {
		const response = await GET({
			locals: {},
			params: { hostId: 'host-1' },
			request: new Request('http://localhost/api/sftp/host-1/list?path=/srv/app'),
			url: new URL('http://localhost/api/sftp/host-1/list?path=/srv/app')
		} as RequestEvent);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'Unauthenticated' });
	});

	it.each([
		['mkdir', MKDIR, new Request('http://localhost/api/sftp/host-1/mkdir', { method: 'POST' })],
		['rename', RENAME, new Request('http://localhost/api/sftp/host-1/rename', { method: 'POST' })],
		[
			'delete',
			DELETE_PATH,
			new Request('http://localhost/api/sftp/host-1/delete?path=/tmp/file', { method: 'DELETE' })
		],
		['read text', READ_TEXT, new Request('http://localhost/api/sftp/host-1/text?path=/tmp/file')],
		[
			'write text',
			WRITE_TEXT,
			new Request('http://localhost/api/sftp/host-1/text', { method: 'PUT' })
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
