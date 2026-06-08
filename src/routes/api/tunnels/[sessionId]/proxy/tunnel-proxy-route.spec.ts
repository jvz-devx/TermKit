import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	proxyHttpTunnelRequest,
	resolveSshTunnelConnectTarget,
	tunnelFailureCode
} from '$lib/server/protocols/ssh-tunnel';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { sshTunnelService } from '$lib/server/services/ssh-tunnels';
import { GET } from './[...path]/+server';

vi.mock('$lib/server/protocols/ssh-tunnel', () => ({
	proxyHttpTunnelRequest: vi.fn(),
	resolveSshTunnelConnectTarget: vi.fn(),
	tunnelFailureCode: vi.fn()
}));

vi.mock('$lib/server/services/connection-sessions', () => ({
	connectionSessionService: {
		failForUser: vi.fn()
	}
}));

vi.mock('$lib/server/services/ssh-tunnels', () => ({
	sshTunnelService: {
		touchSessionForProxy: vi.fn(),
		failSession: vi.fn()
	}
}));

describe('SSH tunnel proxy API route', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(tunnelFailureCode).mockReturnValue('tunnel_proxy_failed');
		vi.mocked(sshTunnelService.failSession).mockResolvedValue(undefined as never);
		vi.mocked(connectionSessionService.failForUser).mockResolvedValue(undefined as never);
	});

	it('proxies authenticated requests to the resolved SSH tunnel target', async () => {
		const upstream = new Response('proxied', {
			status: 202,
			statusText: 'Accepted',
			headers: { 'x-upstream': 'yes' }
		});
		vi.mocked(sshTunnelService.touchSessionForProxy).mockResolvedValueOnce({
			id: 'session-1',
			hostId: 'host-1'
		} as never);
		vi.mocked(resolveSshTunnelConnectTarget).mockResolvedValueOnce({
			host: '127.0.0.1',
			port: 8080
		} as never);
		vi.mocked(proxyHttpTunnelRequest).mockResolvedValueOnce(upstream as never);

		const response = await GET(
			routeEvent({
				pathname: '/api/tunnels/session-1/proxy/api/health',
				path: 'api/health',
				search: '?ready=1'
			})
		);

		expect(response.status).toBe(202);
		expect(response.headers.get('x-upstream')).toBe('yes');
		await expect(response.text()).resolves.toBe('proxied');
		expect(sshTunnelService.touchSessionForProxy).toHaveBeenCalledWith('user-1', 'session-1');
		expect(resolveSshTunnelConnectTarget).toHaveBeenCalledWith('user-1', 'host-1');
		expect(proxyHttpTunnelRequest).toHaveBeenCalledWith(
			{ host: '127.0.0.1', port: 8080 },
			{ id: 'session-1', hostId: 'host-1' },
			expect.any(Request),
			'/api/health?ready=1'
		);
	});

	it('preserves encoded upstream path segments when proxying', async () => {
		const upstream = new Response('proxied');
		vi.mocked(sshTunnelService.touchSessionForProxy).mockResolvedValueOnce({
			id: 'session-1',
			hostId: 'host-1'
		} as never);
		vi.mocked(resolveSshTunnelConnectTarget).mockResolvedValueOnce({
			host: '127.0.0.1',
			port: 8080
		} as never);
		vi.mocked(proxyHttpTunnelRequest).mockResolvedValueOnce(upstream as never);

		await GET(
			routeEvent({
				pathname: '/api/tunnels/session-1/proxy/files/a%20b/%23readme%2Fnotes',
				path: 'files/a b/#readme/notes',
				search: '?download=1'
			})
		);

		expect(proxyHttpTunnelRequest).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.any(Request),
			'/files/a%20b/%23readme%2Fnotes?download=1'
		);
	});

	it('rejects unauthenticated proxy requests before touching tunnel state', async () => {
		const response = await GET(routeEvent({ authenticated: false }));

		expect(response.status).toBe(401);
		expect(sshTunnelService.touchSessionForProxy).not.toHaveBeenCalled();
		expect(sshTunnelService.failSession).not.toHaveBeenCalled();
	});

	it('records unavailable tunnel failures after the session has been touched', async () => {
		const error = new Error('connect failed');
		vi.mocked(sshTunnelService.touchSessionForProxy).mockResolvedValueOnce({
			id: 'session-1',
			hostId: 'host-1'
		} as never);
		vi.mocked(resolveSshTunnelConnectTarget).mockResolvedValueOnce({
			host: '127.0.0.1',
			port: 8080
		} as never);
		vi.mocked(proxyHttpTunnelRequest).mockRejectedValueOnce(error);
		vi.mocked(tunnelFailureCode).mockReturnValueOnce('target_unreachable');

		const response = await GET(routeEvent({ path: undefined }));

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toMatchObject({ error: 'connect failed' });
		expect(sshTunnelService.failSession).toHaveBeenCalledWith(
			'user-1',
			'session-1',
			'target_unreachable'
		);
		expect(connectionSessionService.failForUser).toHaveBeenCalledWith(
			'user-1',
			'session-1',
			'target_unreachable'
		);
	});
});

function routeEvent(
	input: { pathname?: string; path?: string; search?: string; authenticated?: boolean } = {}
) {
	const pathname = input.pathname ?? '/api/tunnels/session-1/proxy';
	return {
		request: new Request(`https://termix.test${pathname}${input.search ?? ''}`),
		params: { sessionId: 'session-1', path: input.path },
		url: new URL(`https://termix.test${pathname}${input.search ?? ''}`),
		locals: input.authenticated === false ? {} : { user: { id: 'user-1' } }
	} as Parameters<typeof GET>[0];
}
