import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { GET } from '../../../routes/api/sftp/[hostId]/list/+server';

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
});
