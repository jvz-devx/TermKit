import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
	installWebSocketUpgrades,
	parseWebSocketRoute,
	type AuthenticatedWebSocketSession
} from './upgrade';
import { SessionTicketConsumer } from './ticket-consumer';
import type { ProtocolAdapter } from '$lib/server/protocols';
import { HostService } from '$lib/server/services/hosts';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import { SessionTicketService } from '$lib/server/services/session-tickets';
import type {
	ConnectionSessionRecord,
	CredentialCrypto,
	EncryptionMetadata
} from '$lib/server/services/types';
import type {
	ConnectionSessionLifecycleRecorder,
	StartConnectionSessionInput
} from '$lib/server/services/connection-sessions';

const servers: ReturnType<typeof createServer>[] = [];

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

	it('rejects live SSH upgrades before consuming attach tickets when no live manager is installed', async () => {
		expect.assertions(2);

		let attachConsumeCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume() {
					attachConsumeCalled = true;
					return testSshAttachTicket();
				}
			}
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/live/ticket-1');

		expect(response).toContain('501 Live SSH manager unavailable');
		expect(attachConsumeCalled).toBe(false);
	});

	it('rejects invalid live SSH attach tickets before the manager is called', async () => {
		expect.assertions(3);

		let consumedForUserId: string | undefined;
		let managerCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume(_ticket, userId) {
					consumedForUserId = userId;
					return null;
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

		expect(response).toContain('401 Invalid or expired SSH attach ticket');
		expect(consumedForUserId).toBe('user-1');
		expect(managerCalled).toBe(false);
	});

	it('rejects live SSH attach tickets for a different authenticated user', async () => {
		expect.assertions(3);

		let consumedForUserId: string | undefined;
		let managerCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator({ userId: 'user-2' }),
			sshAttachTickets: {
				async consume(_ticket, userId) {
					consumedForUserId = userId;
					return testSshAttachTicket({ userId: 'user-1' });
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

		expect(response).toContain('401 Invalid or expired SSH attach ticket');
		expect(consumedForUserId).toBe('user-2');
		expect(managerCalled).toBe(false);
	});

	it('consumes live SSH attach tickets and hands the socket to the live SSH manager', async () => {
		expect.assertions(3);

		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume(ticket, userId) {
					expect({ ticket, userId }).toEqual({
						ticket: 'attach-ticket-1',
						userId: 'user-1'
					});
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle(socket, attachTicket) {
					expect(attachTicket).toEqual(testSshAttachTicket());
					socket.close(1000, 'ok');
				}
			}
		});

		await listen(server);

		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toEqual(1000);
	});

	it('records remote live SSH shell closure as ended instead of detached', async () => {
		expect.assertions(2);

		const calls: string[] = [];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume() {
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle(socket) {
					setTimeout(() => socket.close(1000, 'ssh shell closed'), 0);
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1000);
		await waitFor(() => calls.includes('end:ssh-live-session-1'));
		expect(calls).toEqual(['attached:ssh-live-session-1', 'end:ssh-live-session-1']);
	});

	it('records ordinary live SSH websocket closure as detached', async () => {
		expect.assertions(2);

		const calls: string[] = [];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume() {
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle(socket) {
					setTimeout(() => socket.close(1000, 'browser closed'), 0);
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1000);
		await waitFor(() => calls.includes('detached:ssh-live-session-1'));
		expect(calls).toEqual(['attached:ssh-live-session-1', 'detached:ssh-live-session-1']);
	});

	it('records failed live SSH websocket closure code as failed instead of detached', async () => {
		expect.assertions(2);

		const calls: string[] = [];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume() {
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle(socket) {
					setTimeout(() => socket.close(1011), 0);
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1011);
		await waitFor(() => calls.includes('fail:ssh-live-session-1'));
		expect(calls).toEqual(['attached:ssh-live-session-1', 'fail:ssh-live-session-1']);
	});

	it('does not mark live SSH detached when a newer attachment takes over', async () => {
		expect.assertions(2);

		const calls: string[] = [];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume() {
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle(socket) {
					setTimeout(() => socket.close(1000, 'ssh session reattached'), 0);
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1000);
		await waitFor(() => calls.includes('attached:ssh-live-session-1'));
		expect(calls).toEqual(['attached:ssh-live-session-1']);
	});

	it('does not mark a stale live SSH socket detached when the manager reports an active attachment', async () => {
		expect.assertions(2);

		const calls: string[] = [];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume() {
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle(socket) {
					setTimeout(() => socket.close(1000, 'browser closed'), 0);
				},
				hasActiveAttachment() {
					return true;
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1000);
		await waitFor(() => calls.includes('attached:ssh-live-session-1'));
		expect(calls).toEqual(['attached:ssh-live-session-1']);
	});

	it('records live SSH manager failures as failed', async () => {
		expect.assertions(2);

		const calls: string[] = [];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
			authenticateSession: testSessionAuthenticator(),
			sshAttachTickets: {
				async consume() {
					return testSshAttachTicket();
				}
			},
			liveSshManager: {
				handle() {
					throw new Error('manager failed');
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1011);
		await waitFor(() => calls.includes('fail:ssh-live-session-1'));
		expect(calls).toEqual(['fail:ssh-live-session-1']);
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

	it('consumes matching tickets and hands the socket to the protocol adapter', async () => {
		expect.assertions(3);

		const { hosts, tickets, consumer, repository } = createTicketTestServices();
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
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
});

function createTicketTestServices(): {
	repository: InMemoryTermixServicesRepository;
	hosts: HostService;
	tickets: SessionTicketService;
	consumer: SessionTicketConsumer;
} {
	const repository = new InMemoryTermixServicesRepository();
	const hosts = new HostService(repository);
	const tickets = new SessionTicketService(repository, hosts, repository);
	const crypto: CredentialCrypto = {
		encrypt() {
			throw new Error('encrypt is not used in websocket upgrade tests');
		},
		decrypt(secret) {
			return `decrypted:${secret.ciphertext}`;
		}
	};

	return {
		repository,
		hosts,
		tickets,
		consumer: new SessionTicketConsumer(tickets, hosts, repository, crypto)
	};
}

function testEncryptionMetadata(): EncryptionMetadata {
	return {
		algorithm: 'aes-256-gcm',
		keyVersion: 1,
		iv: 'iv',
		authTag: 'auth-tag',
		salt: 'salt'
	};
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
}

function serverUrl(server: ReturnType<typeof createServer>, path: string, protocol = 'ws'): string {
	const address = server.address() as AddressInfo;
	return `${protocol}://127.0.0.1:${address.port}${path}`;
}

type WebSocketTestOptions = {
	origin?: string;
};

function rawUpgrade(
	server: ReturnType<typeof createServer>,
	path: string,
	options: WebSocketTestOptions = {}
): Promise<string> {
	return new Promise((resolve, reject) => {
		const request = new WebSocket(serverUrl(server, path), {
			headers: options.origin ? { Origin: options.origin } : undefined
		});
		request.on('unexpected-response', (_request, response) => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', (chunk) => {
				body += chunk;
			});
			response.on('end', () =>
				resolve(`${response.statusCode} ${response.statusMessage}\n${body}`)
			);
		});
		request.on('error', reject);
	});
}

function webSocketClose(
	server: ReturnType<typeof createServer>,
	path: string,
	options: WebSocketTestOptions = {}
): Promise<number> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(serverUrl(server, path), {
			headers: options.origin ? { Origin: options.origin } : undefined
		});
		socket.on('close', (code) => resolve(code));
		socket.on('error', reject);
	});
}

type LifecycleCall =
	| { action: 'start'; input: StartConnectionSessionInput }
	| { action: 'active'; id: string }
	| { action: 'end'; id: string }
	| { action: 'fail'; id: string; errorCode: string };

function createLifecycleRecorder(): {
	calls: LifecycleCall[];
	recorder: ConnectionSessionLifecycleRecorder;
} {
	const calls: LifecycleCall[] = [];
	const started = testConnectionSessionRecord('starting');

	return {
		calls,
		recorder: {
			async start(input) {
				calls.push({ action: 'start', input });
				return { ...started, ...input };
			},
			async markActive(id) {
				calls.push({ action: 'active', id });
				return { ...started, id, status: 'active' };
			},
			async end(id) {
				calls.push({ action: 'end', id });
				return { ...started, id, status: 'ended', endedAt: new Date() };
			},
			async fail(id, errorCode) {
				calls.push({ action: 'fail', id, errorCode });
				return { ...started, id, status: 'failed', errorCode, endedAt: new Date() };
			}
		}
	};
}

function testSessionAuthenticator(
	overrides: Partial<AuthenticatedWebSocketSession> = {}
): () => Promise<AuthenticatedWebSocketSession> {
	return async () => ({
		sessionId: 'session-1',
		userId: 'user-1',
		...overrides
	});
}

function testConsumedTicket(overrides: Partial<ReturnType<typeof baseConsumedTicket>> = {}) {
	return {
		...baseConsumedTicket(),
		...overrides
	};
}

function testSshAttachTicket(overrides: Partial<ReturnType<typeof baseSshAttachTicket>> = {}) {
	return {
		...baseSshAttachTicket(),
		...overrides
	};
}

function liveSshSessionRecorder(calls: string[]) {
	return {
		async markAttached(_userId: string, id: string) {
			calls.push(`attached:${id}`);
			return {} as never;
		},
		async markDetached(_userId: string, id: string) {
			calls.push(`detached:${id}`);
			return {} as never;
		},
		async end(_userId: string, id: string) {
			calls.push(`end:${id}`);
			return {} as never;
		},
		async fail(_userId: string, id: string) {
			calls.push(`fail:${id}`);
			return {} as never;
		}
	};
}

function baseConsumedTicket() {
	return {
		ticketId: 'ticket-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ssh' as const,
		target: {
			host: 'shell.example.test',
			port: 22
		}
	};
}

function baseSshAttachTicket() {
	return {
		ticketId: 'attach-ticket-1',
		userId: 'user-1',
		sshLiveSessionId: 'ssh-live-session-1',
		session: {
			...baseConsumedTicket(),
			ticketId: 'ssh-live-session-1'
		},
		terminalCols: 80,
		terminalRows: 24
	};
}

function testConnectionSessionRecord(
	status: ConnectionSessionRecord['status']
): ConnectionSessionRecord {
	const now = new Date('2026-05-13T12:00:00.000Z');

	return {
		id: 'connection-session-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ssh',
		status,
		startedAt: now,
		endedAt: null,
		errorCode: null,
		updatedAt: now
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error('Timed out waiting for websocket lifecycle calls');
}
