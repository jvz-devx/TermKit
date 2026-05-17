import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { installWebSocketUpgrades, type LiveSshManager } from './upgrade';
import {
	baseConsumedTicket,
	listen,
	liveSshSessionRecorder,
	rawUpgrade,
	testSessionAuthenticator,
	testSshAttachTicket,
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

describe('websocket live SSH upgrades', () => {
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

	it('rejects malformed live SSH attach ticket session contexts before manager handoff', async () => {
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
					return testSshAttachTicket({
						session: {
							...baseConsumedTicket(),
							ticketId: 'ssh-live-session-1',
							protocol: 'vnc' as never
						}
					});
				}
			},
			liveSshManager: {
				handle() {
					managerCalled = true;
				}
			}
		});

		await listen(server);
		const response = await rawUpgrade(server, '/ws/ssh/live/attach-ticket-1');

		expect(response).toContain('401 Invalid or expired SSH attach ticket');
		expect(consumedForUserId).toBe('user-1');
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

	it('records explicit live SSH tab closure as ended instead of detached', async () => {
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
					setTimeout(() => socket.close(1000, 'ssh session closed'), 0);
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1000);
		await waitFor(() => calls.includes('end:ssh-live-session-1'));
		expect(calls).toEqual(['attached:ssh-live-session-1', 'end:ssh-live-session-1']);
	});

	it('records immediate live SSH manager close after attach persistence settles', async () => {
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
					socket.close(1011, 'ssh connection failed');
				}
			},
			liveSshSessions: {
				async markAttached(_userId: string, id: string) {
					calls.push(`attached-start:${id}`);
					await new Promise((resolve) => setTimeout(resolve, 20));
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
			}
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1011);
		await waitFor(() => calls.includes('fail:ssh-live-session-1'));
		expect(calls).toEqual([
			'attached-start:ssh-live-session-1',
			'attached:ssh-live-session-1',
			'fail:ssh-live-session-1'
		]);
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

	it('records detached remote live SSH shell closure as ended', async () => {
		expect.assertions(3);

		const calls: string[] = [];
		let closeListener: Parameters<NonNullable<LiveSshManager['onSessionClose']>>[0] | undefined;
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
					setTimeout(() => {
						socket.close(1000, 'browser closed');
						setTimeout(() => {
							closeListener?.({
								sessionId: 'ssh-live-session-1',
								userId: 'user-1',
								reason: 'remote',
								hadActiveAttachment: false
							});
						}, 0);
					}, 0);
				},
				onSessionClose(listener) {
					closeListener = listener;
					return () => {
						closeListener = undefined;
					};
				}
			},
			liveSshSessions: liveSshSessionRecorder(calls)
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1000);
		await waitFor(() => calls.includes('end:ssh-live-session-1'));
		expect(calls.at(0)).toBe('attached:ssh-live-session-1');
		expect(calls.at(-1)).toBe('end:ssh-live-session-1');
	});

	it('waits for slow live SSH attach persistence before manager-side close persistence', async () => {
		expect.assertions(2);

		const calls: string[] = [];
		let closeListener: Parameters<NonNullable<LiveSshManager['onSessionClose']>>[0] | undefined;
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
					setTimeout(() => {
						socket.close(1000, 'browser closed');
						closeListener?.({
							sessionId: 'ssh-live-session-1',
							userId: 'user-1',
							reason: 'remote',
							hadActiveAttachment: false
						});
					}, 0);
				},
				onSessionClose(listener) {
					closeListener = listener;
					return () => {
						closeListener = undefined;
					};
				}
			},
			liveSshSessions: {
				async markAttached(_userId: string, id: string) {
					calls.push(`attached-start:${id}`);
					await new Promise((resolve) => setTimeout(resolve, 20));
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
			}
		});

		await listen(server);
		await expect(webSocketClose(server, '/ws/ssh/live/attach-ticket-1')).resolves.toBe(1000);
		await waitFor(() => calls.includes('end:ssh-live-session-1'));
		expect(calls).toEqual([
			'attached-start:ssh-live-session-1',
			'attached:ssh-live-session-1',
			'detached:ssh-live-session-1',
			'end:ssh-live-session-1'
		]);
	});

	it('records abnormal live SSH browser disconnect as detached', async () => {
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
		await waitFor(() => calls.includes('detached:ssh-live-session-1'));
		expect(calls).toEqual(['attached:ssh-live-session-1', 'detached:ssh-live-session-1']);
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
		expect.assertions(3);

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
		expect(calls).not.toContain('attached:ssh-live-session-1');
	});

	it('unsubscribes live SSH manager close persistence when the HTTP server closes', () => {
		expect.assertions(3);

		let closeListener: Parameters<NonNullable<LiveSshManager['onSessionClose']>>[0] | undefined;
		let releaseCount = 0;
		const server = createServer((_request, response) => response.end('ok'));

		installWebSocketUpgrades(server, {
			liveSshManager: {
				handle() {
					throw new Error('unused manager');
				},
				onSessionClose(listener) {
					closeListener = listener;
					return () => {
						closeListener = undefined;
						releaseCount += 1;
					};
				}
			}
		});

		expect(closeListener).toBeDefined();
		server.emit('close');
		expect(releaseCount).toBe(1);
		expect(closeListener).toBeUndefined();
	});
});
