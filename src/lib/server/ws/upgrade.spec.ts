import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { installWebSocketUpgrades, parseWebSocketRoute } from './upgrade';
import type { ConsumedTicket, ProtocolAdapter, TicketConsumer } from '$lib/server/protocols';

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

		const consumed: ConsumedTicket = {
			ticketId: 'ticket-1',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'rdp',
			target: { host: '127.0.0.1', port: 3389 }
		};
		const tickets: TicketConsumer = {
			async consume(ticket, protocol) {
				expect({ ticket, protocol }).toEqual({ ticket: 'good-ticket', protocol: 'rdp' });
				return consumed;
			}
		};
		const adapters: ProtocolAdapter[] = [
			{
				protocol: 'rdp',
				handle(socket, ticket) {
					expect(ticket).toBe(consumed);
					socket.close(1000, 'ok');
				}
			}
		];
		const server = createServer((_request, response) => response.end('ok'));
		servers.push(server);

		installWebSocketUpgrades(server, { tickets, adapters });
		await listen(server);

		await expect(webSocketClose(server, '/ws/rdp/good-ticket')).resolves.toEqual(1000);
	});
});

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
