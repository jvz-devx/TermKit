import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { installWebSocketUpgrades } from './upgrade';
import {
	createLifecycleRecorder,
	listen,
	rawUpgrade,
	testConsumedTicket,
	testSessionAuthenticator,
	waitFor,
	webSocketClose
} from './upgrade-test-helpers';

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

describe('websocket connection session lifecycle', () => {
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
