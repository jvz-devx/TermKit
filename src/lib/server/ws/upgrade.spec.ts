import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWebSocketUpgrades, parseWebSocketRoute } from './upgrade';
import { CredentialEncryptionError } from '$lib/server/crypto/credentials';
import type { ProtocolAdapter } from '$lib/server/protocols';
import {
	createClosingAdapter,
	createLifecycleRecorder,
	createTicketTestServices,
	listen,
	rawUpgrade,
	testConsumedTicket,
	testEncryptionMetadata,
	testSessionAuthenticator,
	testSshAttachTicket,
	testTunnelSession,
	waitFor,
	webSocketClose
} from './upgrade-test-helpers';

const tunnelMocks = vi.hoisted(() => {
	const sshTunnelService = {
		touchSessionForProxy: vi.fn(),
		failSession: vi.fn()
	};
	const resolveSshTunnelConnectTarget = vi.fn();
	const proxyTcpTunnelWebSocket = vi.fn();
	const tunnelFailureCode = vi.fn();

	return {
		sshTunnelService,
		resolveSshTunnelConnectTarget,
		proxyTcpTunnelWebSocket,
		tunnelFailureCode,
		reset() {
			sshTunnelService.touchSessionForProxy.mockReset();
			sshTunnelService.failSession.mockReset();
			resolveSshTunnelConnectTarget.mockReset();
			proxyTcpTunnelWebSocket.mockReset();
			tunnelFailureCode.mockReset();
			sshTunnelService.failSession.mockResolvedValue(undefined);
			tunnelFailureCode.mockReturnValue('tunnel_proxy_failed');
		}
	};
});

vi.mock('$lib/server/services/ssh-tunnels', () => ({
	sshTunnelService: tunnelMocks.sshTunnelService
}));

vi.mock('$lib/server/protocols/ssh-tunnel', () => ({
	resolveSshTunnelConnectTarget: tunnelMocks.resolveSshTunnelConnectTarget,
	proxyTcpTunnelWebSocket: tunnelMocks.proxyTcpTunnelWebSocket,
	tunnelFailureCode: tunnelMocks.tunnelFailureCode
}));

const servers: ReturnType<typeof createServer>[] = [];

beforeEach(() => {
	tunnelMocks.reset();
});

afterEach(async () => {
	await Promise.all(
		servers.map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
				})
		)
	);
	servers.length = 0;
});

describe('websocket upgrade routing', () => {
	it('parses protocol websocket routes', () => {
		expect.assertions(1);

		expect(parseWebSocketRoute({ url: '/ws/ssh/ticket-123?ignored=1' })).toEqual({
			protocol: 'ssh',
			ticket: 'ticket-123'
		});
	});

	it('parses live SSH websocket routes', () => {
		expect.assertions(1);

		expect(parseWebSocketRoute({ url: '/ws/ssh/live/ticket-123?ignored=1' })).toEqual({
			protocol: 'ssh',
			ticket: 'ticket-123',
			live: true
		});
	});

	it('parses SSH tunnel websocket routes', () => {
		expect.assertions(1);

		expect(parseWebSocketRoute({ url: '/ws/tunnel/session-123?ignored=1' })).toEqual({
			tunnel: true,
			sessionId: 'session-123'
		});
	});

	it('decodes percent-encoded route tickets and session ids', () => {
		expect.assertions(3);

		expect(parseWebSocketRoute({ url: '/ws/ssh/ticket%2Bone%3D' })).toEqual({
			protocol: 'ssh',
			ticket: 'ticket+one='
		});
		expect(parseWebSocketRoute({ url: '/ws/ssh/live/live%2Fticket' })).toEqual({
			protocol: 'ssh',
			ticket: 'live/ticket',
			live: true
		});
		expect(parseWebSocketRoute({ url: '/ws/tunnel/session%2Fone' })).toEqual({
			tunnel: true,
			sessionId: 'session/one'
		});
	});

	it('rejects malformed percent-encoded route tickets and session ids', () => {
		expect.assertions(3);

		expect(parseWebSocketRoute({ url: '/ws/ssh/%E0%A4%A' })).toBeNull();
		expect(parseWebSocketRoute({ url: '/ws/ssh/live/%E0%A4%A' })).toBeNull();
		expect(parseWebSocketRoute({ url: '/ws/tunnel/%E0%A4%A' })).toBeNull();
	});

	it('does not expose an RDP websocket route', () => {
		expect.assertions(1);

		expect(parseWebSocketRoute({ url: '/ws/rdp/ticket-123' })).toBeNull();
	});

	it('rejects path mismatches before auth or ticket lookup', async () => {
		expect.assertions(6);

		const authenticateSession = vi.fn(testSessionAuthenticator());
		let consumeCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession,
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket();
				}
			}
		});

		await listen(server);

		await expect(rawUpgrade(server, '/ws/ssh')).resolves.toContain('404 Unknown websocket route');
		await expect(rawUpgrade(server, '/ws/ssh/ticket-1/extra')).resolves.toContain(
			'404 Unknown websocket route'
		);
		await expect(rawUpgrade(server, '/ws/tunnels/session-1')).resolves.toContain(
			'404 Unknown websocket route'
		);
		await expect(rawUpgrade(server, '/ws/rdp/ticket-1')).resolves.toContain(
			'404 Unknown websocket route'
		);
		expect(authenticateSession).not.toHaveBeenCalled();
		expect(consumeCalled).toBe(false);
	});

	it('leaves ignored upgrade paths for later server upgrade handlers', async () => {
		expect.assertions(1);

		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);
		installWebSocketUpgrades(server, {
			ignoredPaths: [/^\/vite-hmr$/],
			authenticateSession: testSessionAuthenticator()
		});
		server.on('upgrade', (_request, socket) => {
			socket.write('HTTP/1.1 418 Ignored\r\nConnection: close\r\nContent-Length: 7\r\n\r\nignored');
			socket.destroy();
		});

		await listen(server);
		const response = await rawUpgrade(server, '/vite-hmr');

		expect(response).toContain('418 Ignored');
	});

	it('preserves normal SSH ticket routes when a ticket starts with live', async () => {
		expect.assertions(4);

		let attachConsumeCalled = false;
		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume(ticket, protocol, userId) {
					expect({ ticket, protocol, userId }).toEqual({
						ticket: 'live-ticket',
						protocol: 'ssh',
						userId: 'user-1'
					});
					return testConsumedTicket();
				}
			},
			sshAttachTickets: {
				async consume() {
					attachConsumeCalled = true;
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle() {
					throw new Error('live SSH manager should not handle normal SSH ticket routes');
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle(socket) {
						adapterCalled = true;
						socket.close(1000, 'ok');
					}
				}
			]
		});

		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/live-ticket')).resolves.toEqual(1000);
		expect(adapterCalled).toBe(true);
		expect(attachConsumeCalled).toBe(false);
	});

	it('rejects live SSH upgrades without an authenticated session before consuming attach tickets', async () => {
		expect.assertions(3);

		let attachConsumeCalled = false;
		let managerCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			sshAttachTickets: {
				async consume() {
					attachConsumeCalled = true;
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle() {
					managerCalled = true;
				}
			}
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/live/ticket-1');

		expect(response).toContain('401 Authentication required');
		expect(attachConsumeCalled).toBe(false);
		expect(managerCalled).toBe(false);
	});

	it('rejects invalid authenticated session objects before consuming tickets', async () => {
		expect.assertions(3);

		let consumeCalled = false;
		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator({ userId: '' }),
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			]
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/ticket-1');

		expect(response).toContain('401 Authentication required');
		expect(consumeCalled).toBe(false);
		expect(adapterCalled).toBe(false);
	});

	it('accepts SSH tunnel websocket upgrades and proxies the socket through the touched session', async () => {
		expect.assertions(6);

		const lifecycle = createLifecycleRecorder();
		const tunnelSession = testTunnelSession();
		const sshTarget = {
			userId: 'user-1',
			hostId: 'host-1',
			host: 'shell.example.test',
			port: 22,
			username: 'ops'
		};
		tunnelMocks.sshTunnelService.touchSessionForProxy.mockResolvedValue(tunnelSession);
		tunnelMocks.resolveSshTunnelConnectTarget.mockResolvedValue(sshTarget);
		tunnelMocks.proxyTcpTunnelWebSocket.mockImplementation(async (_target, _session, socket) => {
			socket.close(1000, 'ok');
		});
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			connectionSessions: lifecycle.recorder
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/tunnel/tunnel-session-1')).resolves.toBe(1000);
		expect(tunnelMocks.sshTunnelService.touchSessionForProxy).toHaveBeenCalledWith(
			'user-1',
			'tunnel-session-1'
		);
		expect(tunnelMocks.resolveSshTunnelConnectTarget).toHaveBeenCalledWith('user-1', 'host-1');
		expect(tunnelMocks.proxyTcpTunnelWebSocket).toHaveBeenCalledWith(
			sshTarget,
			tunnelSession,
			expect.any(WebSocket)
		);
		expect(tunnelMocks.sshTunnelService.failSession).not.toHaveBeenCalled();
		expect(lifecycle.calls).toEqual([]);
	});

	it('rejects unavailable SSH tunnel sessions before resolving SSH targets', async () => {
		expect.assertions(3);

		tunnelMocks.sshTunnelService.touchSessionForProxy.mockResolvedValue(null);
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator()
		});
		await listen(server);
		const response = await rawUpgrade(server, '/ws/tunnel/missing-session');

		expect(response).toContain('404 SSH tunnel session unavailable');
		expect(tunnelMocks.resolveSshTunnelConnectTarget).not.toHaveBeenCalled();
		expect(tunnelMocks.proxyTcpTunnelWebSocket).not.toHaveBeenCalled();
	});

	it('marks SSH tunnel sessions failed when SSH target resolution fails before upgrade', async () => {
		expect.assertions(5);

		const lifecycle = createLifecycleRecorder();
		tunnelMocks.sshTunnelService.touchSessionForProxy.mockResolvedValue(testTunnelSession());
		tunnelMocks.resolveSshTunnelConnectTarget.mockResolvedValue(null);
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			connectionSessions: lifecycle.recorder
		});
		await listen(server);
		const response = await rawUpgrade(server, '/ws/tunnel/tunnel-session-1');

		expect(response).toContain('502 SSH tunnel target unavailable');
		expect(tunnelMocks.sshTunnelService.failSession).toHaveBeenCalledWith(
			'user-1',
			'tunnel-session-1',
			'credential_missing'
		);
		expect(lifecycle.calls).toEqual([
			{ action: 'fail', id: 'tunnel-session-1', errorCode: 'credential_missing' }
		]);
		expect(tunnelMocks.proxyTcpTunnelWebSocket).not.toHaveBeenCalled();
		expect(tunnelMocks.tunnelFailureCode).not.toHaveBeenCalled();
	});

	it('marks SSH tunnel sessions failed when websocket proxying fails after upgrade', async () => {
		expect.assertions(4);

		const lifecycle = createLifecycleRecorder();
		const proxyError = new Error('target unreachable');
		tunnelMocks.sshTunnelService.touchSessionForProxy.mockResolvedValue(testTunnelSession());
		tunnelMocks.resolveSshTunnelConnectTarget.mockResolvedValue({
			userId: 'user-1',
			hostId: 'host-1',
			host: 'shell.example.test',
			port: 22,
			username: 'ops'
		});
		tunnelMocks.proxyTcpTunnelWebSocket.mockRejectedValue(proxyError);
		tunnelMocks.tunnelFailureCode.mockReturnValue('target_unreachable');
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			connectionSessions: lifecycle.recorder
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/tunnel/tunnel-session-1')).resolves.toBe(1011);
		await waitFor(() => tunnelMocks.sshTunnelService.failSession.mock.calls.length > 0);
		expect(tunnelMocks.tunnelFailureCode).toHaveBeenCalledWith(proxyError);
		expect(tunnelMocks.sshTunnelService.failSession).toHaveBeenCalledWith(
			'user-1',
			'tunnel-session-1',
			'target_unreachable'
		);
		expect(lifecycle.calls).toEqual([
			{ action: 'fail', id: 'tunnel-session-1', errorCode: 'target_unreachable' }
		]);
	});

	it('rejects upgrades with invalid tickets before an adapter is called', async () => {
		expect.assertions(2);

		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return null;
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			]
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/bad-ticket');

		expect(response).toContain('401 Invalid or expired session ticket');
		expect(adapterCalled).toBe(false);
	});

	it('rejects cross-origin websocket upgrades before consuming tickets', async () => {
		expect.assertions(3);

		let consumeCalled = false;
		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			allowedOrigins: ['https://termix.example'],
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			]
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/ticket-1', {
			origin: 'https://evil.example'
		});

		expect(response).toContain('403 WebSocket origin is not allowed');
		expect(consumeCalled).toBe(false);
		expect(adapterCalled).toBe(false);
	});

	it('rejects missing origins when origin is required before consuming tickets', async () => {
		expect.assertions(3);

		let consumeCalled = false;
		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			allowedOrigins: ['https://termix.example'],
			requireOrigin: true,
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			]
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/ticket-1');

		expect(response).toContain('403 WebSocket origin is not allowed');
		expect(consumeCalled).toBe(false);
		expect(adapterCalled).toBe(false);
	});

	it('rejects upgrades without an authenticated session before consuming tickets', async () => {
		expect.assertions(3);

		let consumeCalled = false;
		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			]
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/ticket-1');

		expect(response).toContain('401 Authentication required');
		expect(consumeCalled).toBe(false);
		expect(adapterCalled).toBe(false);
	});

	it('rejects malformed websocket route encodings before auth and tickets', async () => {
		expect.assertions(3);

		const authenticateSession = vi.fn(testSessionAuthenticator());
		let consumeCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession,
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket();
				}
			}
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/%E0%A4%A');

		expect(response).toContain('404 Unknown websocket route');
		expect(authenticateSession).not.toHaveBeenCalled();
		expect(consumeCalled).toBe(false);
	});

	it('accepts websocket upgrades from an allowed origin', async () => {
		expect.assertions(1);

		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			allowedOrigins: ['https://termix.example'],
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle(socket) {
						socket.close(1000, 'ok');
					}
				}
			]
		});

		await listen(server);

		await expect(
			webSocketClose(server, '/ws/ssh/ticket-1', { origin: 'https://termix.example' })
		).resolves.toEqual(1000);
	});

	it('rejects tickets whose user does not match the authenticated session', async () => {
		expect.assertions(3);

		let consumedForUserId: string | undefined;
		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator({ userId: 'user-2' }),
			tickets: {
				async consume(_ticket, _protocol, userId) {
					consumedForUserId = userId;
					return testConsumedTicket({ userId: 'user-1' });
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			]
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/ticket-1');

		expect(response).toContain('401 Invalid or expired session ticket');
		expect(consumedForUserId).toBe('user-2');
		expect(adapterCalled).toBe(false);
	});

	it('masks unexpected ticket consumer error details in upgrade diagnostics', async () => {
		expect.assertions(4);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					throw new Error('database url contains password=super-secret');
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						throw new Error('adapter should not receive failed ticket');
					}
				}
			]
		});

		try {
			await listen(server);
			const response = await rawUpgrade(server, '/ws/ssh/ticket-1');
			const warned = JSON.stringify(warn.mock.calls);

			expect(response).toContain('401 Invalid or expired session ticket');
			expect(warn).toHaveBeenCalledWith('WebSocket session ticket upgrade failed', {
				protocol: 'ssh',
				error: {
					name: 'Error',
					message: 'Session ticket upgrade failed before websocket acceptance'
				}
			});
			expect(warned).not.toContain('super-secret');
			expect(warned).not.toContain('password=');
		} finally {
			warn.mockRestore();
		}
	});

	it('masks unexpected authentication error details in upgrade diagnostics', async () => {
		expect.assertions(4);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		let consumeCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			async authenticateSession() {
				throw new Error('cookie token contains secret-session-token');
			},
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket();
				}
			}
		});

		try {
			await listen(server);
			const response = await rawUpgrade(server, '/ws/ssh/ticket-1');
			const warned = JSON.stringify(warn.mock.calls);

			expect(response).toContain('401 Authentication required');
			expect(warn).toHaveBeenCalledWith('WebSocket session authentication failed', {
				error: {
					name: 'Error',
					message: 'Session ticket upgrade failed before websocket acceptance'
				}
			});
			expect(warned).not.toContain('secret-session-token');
			expect(consumeCalled).toBe(false);
		} finally {
			warn.mockRestore();
		}
	});

	it('keeps credential encryption diagnostics actionable without logging raw secrets', async () => {
		expect.assertions(3);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					throw new CredentialEncryptionError(
						'Credential secret could not be decrypted; verify CREDENTIAL_MASTER_KEY'
					);
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						throw new Error('adapter should not receive failed ticket');
					}
				}
			]
		});

		try {
			await listen(server);
			const response = await rawUpgrade(server, '/ws/ssh/ticket-1');
			const warned = JSON.stringify(warn.mock.calls);

			expect(response).toContain('401 Invalid or expired session ticket');
			expect(warn).toHaveBeenCalledWith('WebSocket session ticket upgrade failed', {
				protocol: 'ssh',
				error: {
					name: 'CredentialEncryptionError',
					message: 'Credential secret could not be decrypted; verify CREDENTIAL_MASTER_KEY'
				}
			});
			expect(warned).not.toContain('decrypted-password');
		} finally {
			warn.mockRestore();
		}
	});

	it('rejects unavailable protocol adapters before consuming tickets', async () => {
		expect.assertions(3);

		let consumeCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						throw new Error('unused adapter');
					}
				}
			],
			tickets: {
				async consume() {
					consumeCalled = true;
					return testConsumedTicket({ protocol: 'vnc' as never });
				}
			}
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/vnc/ticket-1');

		expect(response).toContain('501 Protocol adapter unavailable');
		expect(consumeCalled).toBe(false);
		expect(tunnelMocks.proxyTcpTunnelWebSocket).not.toHaveBeenCalled();
	});

	it('consumes matching tickets and hands the socket to the protocol adapter', async () => {
		expect.assertions(3);

		const { hosts, tickets, consumer, repository } = createTicketTestServices();
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Shell password',
			kind: 'password',
			username: 'credential-user',
			encryptedSecret: 'encrypted-password',
			encryption: testEncryptionMetadata(),
			metadata: {},
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			username: 'host-user',
			credentialId: 'credential-1'
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh'
		});
		const adapters: ProtocolAdapter[] = [
			{
				protocol: 'ssh',
				handle(socket, ticket) {
					expect(ticket.target).toEqual({
						host: 'shell.example.test',
						port: 22,
						username: 'host-user',
						credential: {
							kind: 'password',
							username: 'credential-user',
							password: 'decrypted:encrypted-password'
						}
					});
					socket.close(1000, 'ok');
				}
			}
		];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: consumer,
			adapters
		});
		await listen(server);

		await expect(webSocketClose(server, `/ws/ssh/${created.ticket}`)).resolves.toEqual(1000);
		await expect(tickets.consume(created.ticket)).rejects.toMatchObject({
			name: 'TicketConsumedError'
		});
	});

	it('rejects protocol mismatches without consuming the ticket', async () => {
		expect.assertions(3);

		let adapterCalled = false;
		const { hosts, tickets, consumer } = createTicketTestServices();
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh'
		});
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: consumer,
			adapters: [
				{
					protocol: 'vnc',
					handle() {
						adapterCalled = true;
					}
				},
				{
					protocol: 'ssh',
					handle(socket) {
						socket.close(1000, 'ok');
					}
				}
			]
		});
		await listen(server);

		const response = await rawUpgrade(server, `/ws/vnc/${created.ticket}`);

		expect(response).toContain('401 Invalid or expired session ticket');
		expect(adapterCalled).toBe(false);
		await expect(webSocketClose(server, `/ws/ssh/${created.ticket}`)).resolves.toEqual(1000);
	});

	it.each(['ssh', 'vnc', 'telnet'] as const)(
		'dispatches %s upgrades only to the matching protocol adapter',
		async (protocol) => {
			expect.assertions(3);

			const consumedRequests: Array<{ ticket: string; requestedProtocol: string; userId: string }> =
				[];
			const handledProtocols: string[] = [];
			const lifecycle = createLifecycleRecorder();
			const server = createServer((_request, response) => response.end('ok'));
			servers.push(server);

			installWebSocketUpgrades(server, {
				authenticateSession: testSessionAuthenticator(),
				tickets: {
					async consume(ticket, requestedProtocol, userId) {
						consumedRequests.push({
							ticket: ticket ?? '',
							requestedProtocol: requestedProtocol ?? '',
							userId: userId ?? ''
						});
						return testConsumedTicket({ protocol: protocol as never });
					}
				},
				adapters: [
					createClosingAdapter('ssh', handledProtocols),
					createClosingAdapter('vnc', handledProtocols),
					createClosingAdapter('telnet', handledProtocols)
				],
				connectionSessions: lifecycle.recorder
			});

			await listen(server);

			await expect(webSocketClose(server, `/ws/${protocol}/${protocol}-ticket`)).resolves.toEqual(
				1000
			);
			expect(consumedRequests).toEqual([
				{
					ticket: `${protocol}-ticket`,
					requestedProtocol: protocol,
					userId: 'user-1'
				}
			]);
			expect(handledProtocols).toEqual([protocol]);
		}
	);

	it('rejects consumed tickets with invalid session context before recording sessions', async () => {
		expect.assertions(3);

		let adapterCalled = false;
		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return { ...testConsumedTicket(), userId: '' };
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			],
			connectionSessions: lifecycle.recorder
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/ticket-1');

		expect(response).toContain('401 Invalid or expired session ticket');
		expect(adapterCalled).toBe(false);
		expect(lifecycle.calls).toEqual([]);
	});

	it('rejects consumed tickets with invalid target context before recording sessions', async () => {
		expect.assertions(3);

		let adapterCalled = false;
		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket({
						target: {
							host: 'shell.example.test',
							port: 0
						}
					});
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						adapterCalled = true;
					}
				}
			],
			connectionSessions: lifecycle.recorder
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/ticket-1');

		expect(response).toContain('401 Invalid or expired session ticket');
		expect(adapterCalled).toBe(false);
		expect(lifecycle.calls).toEqual([]);
	});

	it('records connection sessions from accepted upgrades through normal close', async () => {
		expect.assertions(2);

		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle(socket) {
						socket.close(1000, 'ok');
					}
				}
			],
			connectionSessions: lifecycle.recorder
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/ticket-1')).resolves.toEqual(1000);
		await waitFor(() => lifecycle.calls.length === 3);
		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active', 'end']);
	});

	it('marks connection sessions failed when an adapter throws', async () => {
		expect.assertions(3);

		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						throw new Error('adapter failed');
					}
				}
			],
			connectionSessions: lifecycle.recorder
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/ticket-1')).resolves.toEqual(1011);
		await waitFor(() => lifecycle.calls.some((call) => call.action === 'fail'));
		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active', 'fail']);
		expect(lifecycle.calls.at(-1)).toMatchObject({
			action: 'fail',
			errorCode: 'adapter_error'
		});
	});

	it('records adapter-specific failure codes and closes once when an adapter throws', async () => {
		expect.assertions(3);

		class HostKeyRejected extends Error {
			override name = 'HostKeyRejected';
		}

		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						throw new HostKeyRejected('host key changed');
					}
				}
			],
			connectionSessions: lifecycle.recorder
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/ticket-1')).resolves.toEqual(1011);
		await waitFor(() => lifecycle.calls.some((call) => call.action === 'fail'));
		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active', 'fail']);
		expect(lifecycle.calls.at(-1)).toMatchObject({
			action: 'fail',
			errorCode: 'adapter_hostkeyrejected'
		});
	});

	it('marks connection sessions failed when an accepted socket closes abnormally', async () => {
		expect.assertions(3);

		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle(socket) {
						socket.close(1012, 'service restart');
					}
				}
			],
			connectionSessions: lifecycle.recorder
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/ticket-1')).resolves.toEqual(1012);
		await waitFor(() => lifecycle.calls.some((call) => call.action === 'fail'));
		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active', 'fail']);
		expect(lifecycle.calls.at(-1)).toMatchObject({
			action: 'fail',
			errorCode: 'websocket_close_1012'
		});
	});

	it('marks connection sessions failed when an accepted socket emits an error', async () => {
		expect.assertions(3);

		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					async handle(socket) {
						socket.emit('error', new Error('client socket failed'));
						socket.close(1000, 'closed after error');
					}
				}
			],
			connectionSessions: lifecycle.recorder
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/ticket-1')).resolves.toEqual(1000);
		await waitFor(() => lifecycle.calls.some((call) => call.action === 'fail'));
		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active', 'fail']);
		expect(lifecycle.calls.at(-1)).toMatchObject({
			action: 'fail',
			errorCode: 'websocket_error'
		});
	});

	it('skips lifecycle cleanup when session start fails before adapter attachment fails', async () => {
		expect.assertions(2);

		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			tickets: {
				async consume() {
					return testConsumedTicket();
				}
			},
			adapters: [
				{
					protocol: 'ssh',
					handle() {
						throw new Error('adapter failed after untracked start');
					}
				}
			],
			connectionSessions: {
				...lifecycle.recorder,
				async start(input) {
					lifecycle.calls.push({ action: 'start', input });
					throw new Error('start failed');
				}
			}
		});
		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/ticket-1')).resolves.toEqual(1011);
		expect(lifecycle.calls).toEqual([
			{
				action: 'start',
				input: {
					userId: 'user-1',
					hostId: 'host-1',
					protocol: 'ssh'
				}
			}
		]);
	});
});
