import { beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialService } from '$lib/server/services/credentials';
import { DELETE, GET as GET_ONE, PATCH } from './[id]/+server';
import { GET, POST } from './+server';

vi.mock('$lib/server/services/credentials', () => ({
	credentialService: {
		list: vi.fn(),
		create: vi.fn(),
		get: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	}
}));

describe('credentials API routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists credentials for the signed-in user', async () => {
		vi.mocked(credentialService.list).mockResolvedValueOnce([{ id: 'cred-1' }] as never);

		const response = await GET(routeEvent({ method: 'GET' }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ credentials: [{ id: 'cred-1' }] });
		expect(credentialService.list).toHaveBeenCalledWith('user-1');
	});

	it('creates credentials without echoing secret material outside the service result', async () => {
		vi.mocked(credentialService.create).mockResolvedValueOnce({
			id: 'cred-2',
			name: 'deploy'
		} as never);

		const response = await POST(
			routeEvent({
				method: 'POST',
				body: { name: 'deploy', kind: 'password', secret: 'super-secret-password' }
			})
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			credential: { id: 'cred-2', name: 'deploy' }
		});
		expect(credentialService.create).toHaveBeenCalledWith('user-1', {
			name: 'deploy',
			kind: 'password',
			secret: 'super-secret-password'
		});
	});

	it('updates a specific credential using the route id', async () => {
		vi.mocked(credentialService.update).mockResolvedValueOnce({
			id: 'cred-1',
			name: 'ops'
		} as never);

		const response = await PATCH(
			routeEvent({
				method: 'PATCH',
				params: { id: 'cred-1' },
				body: { name: 'ops' }
			})
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ credential: { id: 'cred-1', name: 'ops' } });
		expect(credentialService.update).toHaveBeenCalledWith('user-1', 'cred-1', { name: 'ops' });
	});

	it('rejects unauthenticated credential reads without service access', async () => {
		const response = await GET_ONE(
			routeEvent({
				method: 'GET',
				params: { id: 'cred-1' },
				authenticated: false
			})
		);

		expect(response.status).toBe(401);
		expect(credentialService.get).not.toHaveBeenCalled();
	});

	it.each([
		[
			'list',
			() => GET(routeEvent({ method: 'GET', authenticated: false })),
			() => credentialService.list
		],
		[
			'create',
			() =>
				POST(
					routeEvent({
						method: 'POST',
						body: { name: 'deploy', kind: 'password', secret: 'secret' },
						authenticated: false
					})
				),
			() => credentialService.create
		],
		[
			'update',
			() =>
				PATCH(
					routeEvent({
						method: 'PATCH',
						params: { id: 'cred-1' },
						body: { name: 'ops' },
						authenticated: false
					})
				),
			() => credentialService.update
		],
		[
			'delete',
			() =>
				DELETE(
					routeEvent({
						method: 'DELETE',
						params: { id: 'cred-1' },
						authenticated: false
					})
				),
			() => credentialService.delete
		]
	])(
		'rejects unauthenticated credential %s requests before service access',
		async (_name, call, service) => {
			const response = await call();

			expect(response.status).toBe(401);
			expect(service()).not.toHaveBeenCalled();
		}
	);

	it('serializes credential service validation failures with issues', async () => {
		vi.mocked(credentialService.create).mockRejectedValueOnce(
			Object.assign(new Error('name is required; secret is required'), {
				status: 400,
				issues: ['name is required', 'secret is required']
			}) as never
		);

		const response = await POST(routeEvent({ method: 'POST', body: {} }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: 'name is required; secret is required',
			issues: ['name is required', 'secret is required']
		});
	});

	it('serializes policy-blocked credential mutations', async () => {
		vi.mocked(credentialService.update).mockRejectedValueOnce(
			Object.assign(new Error('Credential changes are disabled by workspace policy.'), {
				status: 403,
				code: 'policy_action_disabled',
				category: 'authorization',
				details: { action: 'credentials', state: 'blocked' }
			}) as never
		);

		const response = await PATCH(
			routeEvent({
				method: 'PATCH',
				params: { id: 'cred-1' },
				body: { name: 'ops' }
			})
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: 'Credential changes are disabled by workspace policy.',
			code: 'policy_action_disabled',
			category: 'authorization',
			details: { action: 'credentials', state: 'blocked' }
		});
	});

	it('deletes a credential for the signed-in owner', async () => {
		vi.mocked(credentialService.delete).mockResolvedValueOnce(undefined as never);

		const response = await DELETE(
			routeEvent({
				method: 'DELETE',
				params: { id: 'cred-1' }
			})
		);

		expect(response.status).toBe(204);
		expect(credentialService.delete).toHaveBeenCalledWith('user-1', 'cred-1');
	});
});

function routeEvent(input: {
	method: string;
	body?: Record<string, unknown>;
	params?: Record<string, string>;
	authenticated?: boolean;
}) {
	return {
		request: new Request('https://termix.test/api/credentials', {
			method: input.method,
			body: input.body ? JSON.stringify(input.body) : undefined,
			headers: input.body ? { 'content-type': 'application/json' } : undefined
		}),
		params: input.params ?? {},
		locals: input.authenticated === false ? {} : { user: { id: 'user-1' } }
	} as Parameters<typeof GET>[0];
}
