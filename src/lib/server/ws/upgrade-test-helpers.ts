import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
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
import { SessionTicketConsumer } from './ticket-consumer';
import type { AuthenticatedWebSocketSession } from './upgrade';

export function createTicketTestServices(): {
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

export function testEncryptionMetadata(): EncryptionMetadata {
	return {
		algorithm: 'aes-256-gcm',
		keyVersion: 1,
		iv: 'iv',
		authTag: 'auth-tag',
		salt: 'salt'
	};
}

export function createClosingAdapter(
	protocol: ProtocolAdapter['protocol'],
	calls: string[]
): ProtocolAdapter {
	return {
		protocol,
		handle(socket) {
			calls.push(protocol);
			socket.close(1000, 'ok');
		}
	};
}

export function listen(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
}

export function serverUrl(
	server: ReturnType<typeof createServer>,
	path: string,
	protocol = 'ws'
): string {
	const address = server.address() as AddressInfo;
	return `${protocol}://127.0.0.1:${address.port}${path}`;
}

export type WebSocketTestOptions = {
	origin?: string;
};

export function rawUpgrade(
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

export function webSocketClose(
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

export type LifecycleCall =
	| { action: 'start'; input: StartConnectionSessionInput }
	| { action: 'active'; id: string }
	| { action: 'end'; id: string }
	| { action: 'fail'; id: string; errorCode: string };

export function createLifecycleRecorder(): {
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

export function testSessionAuthenticator(
	overrides: Partial<AuthenticatedWebSocketSession> = {}
): () => Promise<AuthenticatedWebSocketSession> {
	return async () => ({
		sessionId: 'session-1',
		userId: 'user-1',
		...overrides
	});
}

export function testConsumedTicket(overrides: Partial<ReturnType<typeof baseConsumedTicket>> = {}) {
	return {
		...baseConsumedTicket(),
		...overrides
	};
}

export function testSshAttachTicket(
	overrides: Partial<ReturnType<typeof baseSshAttachTicket>> = {}
) {
	return {
		...baseSshAttachTicket(),
		...overrides
	};
}

export function liveSshSessionRecorder(calls: string[]) {
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

export function baseConsumedTicket() {
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

export function baseSshAttachTicket() {
	return {
		ticketId: 'attach-ticket-1',
		userId: 'user-1',
		sshLiveSessionId: 'ssh-live-session-1',
		sessionStatus: 'starting' as const,
		session: {
			...baseConsumedTicket(),
			ticketId: 'ssh-live-session-1'
		},
		terminalCols: 80,
		terminalRows: 24
	};
}

export function testTunnelSession() {
	const now = new Date('2026-05-13T12:00:00.000Z');
	return {
		id: 'tunnel-session-1',
		userId: 'user-1',
		hostId: 'host-1',
		profileId: null,
		targetHost: 'database.internal.test',
		targetPort: 5432,
		publicPath: '/api/tunnels/tunnel-session-1/proxy/',
		status: 'active' as const,
		failureCode: null,
		createdAt: now,
		lastUsedAt: now,
		expiresAt: new Date('2026-05-13T12:10:00.000Z'),
		closedAt: null
	};
}

export function testConnectionSessionRecord(
	status: ConnectionSessionRecord['status']
): ConnectionSessionRecord {
	const now = new Date('2026-05-13T12:00:00.000Z');

	return {
		id: 'connection-session-1',
		userId: 'user-1',
		workspaceId: null,
		hostId: 'host-1',
		protocol: 'ssh',
		status,
		startedAt: now,
		endedAt: null,
		errorCode: null,
		updatedAt: now
	};
}

export async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error('Timed out waiting for websocket lifecycle calls');
}
