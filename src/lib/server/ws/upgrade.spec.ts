import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { installWebSocketUpgrades, parseWebSocketRoute } from './upgrade';
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

	it('rejects upgrades with invalid tickets before an adapter is called', async () => {
		expect.assertions(2);

		let adapterCalled = false;
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
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

		installWebSocketUpgrades(server, { tickets: consumer, adapters });
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

	it('records connection sessions from accepted upgrades through normal close', async () => {
		expect.assertions(2);

		const lifecycle = createLifecycleRecorder();
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, {
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

function rawUpgrade(server: ReturnType<typeof createServer>, path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const request = new WebSocket(serverUrl(server, path));
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

function webSocketClose(server: ReturnType<typeof createServer>, path: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(serverUrl(server, path));
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

function testConsumedTicket() {
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
