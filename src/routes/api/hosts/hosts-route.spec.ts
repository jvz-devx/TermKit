import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostService } from '$lib/server/services/hosts';
import { DELETE, GET as GET_ONE, PATCH } from './[id]/+server';
import { GET, POST } from './+server';

vi.mock('$lib/server/services/hosts', () => ({
	hostService: {
		list: vi.fn(),
		create: vi.fn(),
		get: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	}
}));

describe('hosts API routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists hosts for the signed-in user', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([{ id: 'host-1' }] as never);

		const response = await GET(routeEvent({ method: 'GET' }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ hosts: [{ id: 'host-1' }] });
		expect(hostService.list).toHaveBeenCalledWith('user-1');
	});

	it('creates hosts with parsed JSON input for the signed-in user', async () => {
		vi.mocked(hostService.create).mockResolvedValueOnce({ id: 'host-2' } as never);

		const response = await POST(
			routeEvent({
				method: 'POST',
				body: { name: 'ops', hostname: 'ops.internal' }
			})
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ host: { id: 'host-2' } });
		expect(hostService.create).toHaveBeenCalledWith('user-1', {
			name: 'ops',
			hostname: 'ops.internal'
		});
	});

	it('updates a specific host using the route id', async () => {
		vi.mocked(hostService.update).mockResolvedValueOnce({ id: 'host-1', name: 'renamed' } as never);

		const response = await PATCH(
			routeEvent({
				method: 'PATCH',
				params: { id: 'host-1' },
				body: { name: 'renamed' }
			})
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ host: { id: 'host-1', name: 'renamed' } });
		expect(hostService.update).toHaveBeenCalledWith('user-1', 'host-1', { name: 'renamed' });
	});

	it('rejects unauthenticated host reads without service access', async () => {
		const response = await GET_ONE(
			routeEvent({
				method: 'GET',
				params: { id: 'host-1' },
				authenticated: false
			})
		);

		expect(response.status).toBe(401);
		expect(hostService.get).not.toHaveBeenCalled();
	});

	it.each([
		[
			'list',
			() => GET(routeEvent({ method: 'GET', authenticated: false })),
			() => hostService.list
		],
		[
			'create',
			() =>
				POST(
					routeEvent({
						method: 'POST',
						body: { name: 'ops', hostname: 'ops.internal' },
						authenticated: false
					})
				),
			() => hostService.create
		],
		[
			'update',
			() =>
				PATCH(
					routeEvent({
						method: 'PATCH',
						params: { id: 'host-1' },
						body: { name: 'renamed' },
						authenticated: false
					})
				),
			() => hostService.update
		],
		[
			'delete',
			() =>
				DELETE(
					routeEvent({
						method: 'DELETE',
						params: { id: 'host-1' },
						authenticated: false
					})
				),
			() => hostService.delete
		]
	])(
		'rejects unauthenticated host %s requests before service access',
		async (_name, call, service) => {
			const response = await call();

			expect(response.status).toBe(401);
			expect(service()).not.toHaveBeenCalled();
		}
	);

	it('serializes host service validation failures with issues', async () => {
		vi.mocked(hostService.create).mockRejectedValueOnce(
			Object.assign(new Error('name is required; hostname is required'), {
				status: 400,
				issues: ['name is required', 'hostname is required']
			}) as never
		);

		const response = await POST(routeEvent({ method: 'POST', body: {} }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: 'name is required; hostname is required',
			issues: ['name is required', 'hostname is required']
		});
	});

	it('serializes policy-blocked host mutations', async () => {
		vi.mocked(hostService.update).mockRejectedValueOnce(
			Object.assign(new Error('Host edits require a workspace owner.'), {
				status: 403,
				code: 'policy_role_denied',
				category: 'authorization',
				details: { action: 'host_edit', state: 'blocked', requiredRole: 'owner' }
			}) as never
		);

		const response = await PATCH(
			routeEvent({
				method: 'PATCH',
				params: { id: 'host-1' },
				body: { name: 'renamed' }
			})
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: 'Host edits require a workspace owner.',
			code: 'policy_role_denied',
			category: 'authorization',
			details: { action: 'host_edit', state: 'blocked', requiredRole: 'owner' }
		});
	});

	it('deletes a host for the signed-in owner', async () => {
		vi.mocked(hostService.delete).mockResolvedValueOnce(undefined as never);

		const response = await DELETE(
			routeEvent({
				method: 'DELETE',
				params: { id: 'host-1' }
			})
		);

		expect(response.status).toBe(204);
		expect(hostService.delete).toHaveBeenCalledWith('user-1', 'host-1');
	});
});

function routeEvent(input: {
	method: string;
	body?: Record<string, unknown>;
	params?: Record<string, string>;
	authenticated?: boolean;
}) {
	return {
		request: new Request('https://termix.test/api/hosts', {
			method: input.method,
			body: input.body ? JSON.stringify(input.body) : undefined,
			headers: input.body ? { 'content-type': 'application/json' } : undefined
		}),
		params: input.params ?? {},
		locals: input.authenticated === false ? {} : { user: { id: 'user-1' } }
	} as Parameters<typeof GET>[0];
}
