import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { POST } from './+server';

vi.mock('$lib/server/services/connection-sessions', () => ({
	connectionSessionService: {
		markActiveForUser: vi.fn(),
		endForUser: vi.fn(),
		failForUser: vi.fn()
	}
}));

describe('connection session lifecycle API route', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('records an ended lifecycle event for the signed-in owner', async () => {
		vi.mocked(connectionSessionService.endForUser).mockResolvedValueOnce({
			id: 'session-1'
		} as never);

		const response = await POST(
			routeEvent({
				connectionSessionId: 'session-1',
				event: 'ended'
			})
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(connectionSessionService.endForUser).toHaveBeenCalledWith('user-1', 'session-1');
	});

	it('records a connected lifecycle event for the signed-in owner', async () => {
		vi.mocked(connectionSessionService.markActiveForUser).mockResolvedValueOnce({
			id: 'session-1'
		} as never);

		const response = await POST(
			routeEvent({
				connectionSessionId: 'session-1',
				event: 'connected'
			})
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(connectionSessionService.markActiveForUser).toHaveBeenCalledWith('user-1', 'session-1');
	});

	it('rejects unauthenticated lifecycle writes', async () => {
		const response = await POST(
			routeEvent(
				{
					connectionSessionId: 'session-1',
					event: 'ended'
				},
				false
			)
		);

		expect(response.status).toBe(401);
		expect(connectionSessionService.markActiveForUser).not.toHaveBeenCalled();
		expect(connectionSessionService.endForUser).not.toHaveBeenCalled();
	});

	it('rejects unsupported lifecycle events', async () => {
		const response = await POST(
			routeEvent({
				connectionSessionId: 'session-1',
				event: 'active'
			})
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			issues: ['connectionSessionId is invalid or event is unsupported']
		});
	});

	it('records failed lifecycle events with sanitized error codes', async () => {
		vi.mocked(connectionSessionService.failForUser).mockResolvedValueOnce({
			id: 'session-1'
		} as never);

		const response = await POST(
			routeEvent({
				connectionSessionId: 'session-1',
				event: 'failed',
				errorCode: ' SSH Tunnel: Proxy Failed! '
			})
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(connectionSessionService.failForUser).toHaveBeenCalledWith(
			'user-1',
			'session-1',
			'ssh_tunnel:_proxy_failed_'
		);
	});
});

function routeEvent(body: Record<string, unknown>, authenticated = true) {
	return {
		request: new Request('https://termix.test/api/connection-sessions/lifecycle', {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		}),
		locals: authenticated ? { user: { id: 'user-1' } } : {}
	} as Parameters<typeof POST>[0];
}
