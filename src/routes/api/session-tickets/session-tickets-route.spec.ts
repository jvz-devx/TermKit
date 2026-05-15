import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionTicketService } from '$lib/server/services/session-tickets';
import { POST } from './+server';

vi.mock('$lib/server/services/session-tickets', () => ({
	sessionTicketService: {
		create: vi.fn()
	}
}));

describe('session tickets API route', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a session ticket for the signed-in user', async () => {
		const expiresAt = new Date('2026-05-14T10:00:00.000Z');
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'ticket-1',
			record: { expiresAt }
		} as never);

		const response = await POST(
			routeEvent({
				hostId: 'host-1',
				protocol: 'ssh',
				ttlMs: 60_000
			})
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			ticket: 'ticket-1',
			expiresAt: expiresAt.toISOString()
		});
		expect(sessionTicketService.create).toHaveBeenCalledWith('user-1', {
			hostId: 'host-1',
			protocol: 'ssh',
			ttlMs: 60_000
		});
	});

	it('rejects unauthenticated ticket creation without invoking the service', async () => {
		const response = await POST(routeEvent({ hostId: 'host-1', protocol: 'ssh' }, false));

		expect(response.status).toBe(401);
		expect(sessionTicketService.create).not.toHaveBeenCalled();
	});

	it('serializes session ticket validation errors from the service boundary', async () => {
		vi.mocked(sessionTicketService.create).mockRejectedValueOnce(
			Object.assign(new Error('protocol must match the selected host'), {
				status: 400,
				issues: ['protocol must match the selected host']
			}) as never
		);

		const response = await POST(routeEvent({ hostId: 'host-1', protocol: 'rdp' }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: 'protocol must match the selected host',
			issues: ['protocol must match the selected host']
		});
	});

	it('serializes policy-blocked session launch states', async () => {
		vi.mocked(sessionTicketService.create).mockRejectedValueOnce(
			Object.assign(new Error('Launch sessions requires the operator role.'), {
				status: 403,
				code: 'policy_role_denied',
				category: 'authorization',
				details: { action: 'launch', state: 'blocked', requiredRole: 'operator' }
			}) as never
		);

		const response = await POST(routeEvent({ hostId: 'host-1', protocol: 'ssh' }));

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: 'Launch sessions requires the operator role.',
			code: 'policy_role_denied',
			category: 'authorization',
			details: { action: 'launch', state: 'blocked', requiredRole: 'operator' }
		});
	});
});

function routeEvent(body: Record<string, unknown>, authenticated = true) {
	return {
		request: new Request('https://termix.test/api/session-tickets', {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		}),
		params: {},
		locals: authenticated ? { user: { id: 'user-1' } } : {}
	} as Parameters<typeof POST>[0];
}
