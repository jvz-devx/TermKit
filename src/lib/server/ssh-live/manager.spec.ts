import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { connectTrustedSsh } from '../protocols/ssh-connect';
import type { ConsumedTicket } from '../protocols/types';
import {
	LiveSshAttachError,
	LiveSshManager,
	type LiveSshAttachResult,
	type LiveSshChannel,
	type LiveSshClient,
	type LiveSshSession
} from './manager';
import type { SshAttachTicket } from './types';

vi.mock('../protocols/ssh-connect', () => ({
	connectTrustedSsh: vi.fn()
}));

const mockedConnectTrustedSsh = vi.mocked(connectTrustedSsh);

afterEach(() => {
	mockedConnectTrustedSsh.mockReset();
});

describe('LiveSshManager', () => {
	it('starts an ssh shell from a consumed ticket and writes websocket input to the shell', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		expect(harness.client.shellOptions).toEqual({
			term: 'xterm-256color',
			cols: 80,
			rows: 24,
			width: 0,
			height: 0
		});

		socket.emitMessage(Buffer.from('ls\n'), true);
		expect(harness.channel.writes).toEqual([Buffer.from('ls\n')]);
	});

	it('reuses a starting session and keeps the original terminal size', () => {
		const clients: FakeSshClient[] = [];
		const manager = new LiveSshManager({
			createClient: () => {
				const client = new FakeSshClient();
				clients.push(client);
				return client;
			}
		});

		const firstSession = manager.startWithSize(testTicket(), { cols: 120, rows: 30 });
		const secondSession = manager.start(testTicket());

		expect(secondSession).toBe(firstSession);
		expect(clients).toHaveLength(1);

		clients[0].emit('ready');
		expect(clients[0].shellOptions).toMatchObject({ cols: 120, rows: 30 });
	});

	it('uses attach-ticket session ids and terminal dimensions when handling websocket attaches', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();
		const attachTicket: SshAttachTicket = {
			ticketId: 'attach-ticket-1',
			userId: 'user-1',
			sshLiveSessionId: 'live-session-1',
			sessionStatus: 'starting',
			session: testTicket({ ticketId: 'consumed-ticket-1' }),
			terminalCols: 132,
			terminalRows: 43
		};

		const result = manager.handle(socket as unknown as WebSocket, attachTicket);
		harness.client.emit('ready');

		expect(result.sessionId).toBe('live-session-1');
		expect(manager.get('live-session-1')).toBeDefined();
		expect(harness.client.shellOptions).toMatchObject({ cols: 132, rows: 43 });
	});

	it('bootstraps a detached attach ticket when the manager session is missing', () => {
		const createClient = vi.fn(() => new FakeSshClient());
		const manager = new LiveSshManager({ createClient });
		const socket = new FakeWebSocket();
		const attachTicket: SshAttachTicket = {
			ticketId: 'attach-ticket-1',
			userId: 'user-1',
			sshLiveSessionId: 'live-session-1',
			sessionStatus: 'detached',
			session: testTicket({ ticketId: 'consumed-ticket-1' }),
			terminalCols: 132,
			terminalRows: 43
		};

		const result = manager.handle(socket as unknown as WebSocket, attachTicket);

		expect(result.sessionId).toBe('live-session-1');
		expect(manager.get('live-session-1')).toBeDefined();
		expect(createClient).toHaveBeenCalledTimes(1);
	});

	it('reattaches a detached attach ticket only when the manager still has the session', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const firstSocket = new FakeWebSocket();
		const secondSocket = new FakeWebSocket();
		const attachTicket: SshAttachTicket = {
			ticketId: 'attach-ticket-1',
			userId: 'user-1',
			sshLiveSessionId: 'live-session-1',
			sessionStatus: 'starting',
			session: testTicket({ ticketId: 'consumed-ticket-1' }),
			terminalCols: 132,
			terminalRows: 43
		};

		manager.handle(firstSocket as unknown as WebSocket, attachTicket);
		firstSocket.emitClose();

		const result = manager.handle(secondSocket as unknown as WebSocket, {
			...attachTicket,
			ticketId: 'attach-ticket-2',
			sessionStatus: 'detached'
		});

		expect(result.sessionId).toBe('live-session-1');
		expect(harness.client.connectConfig).toBeDefined();
	});

	it('keeps the ssh shell alive across websocket detach and replays bounded scrollback', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient, scrollbackBytes: 8 });
		const firstSocket = new FakeWebSocket();
		const secondSocket = new FakeWebSocket();

		manager.attach(testTicket(), firstSocket as unknown as WebSocket);
		harness.client.emit('ready');
		harness.channel.emitData(Buffer.from('hello'));
		firstSocket.emitClose();
		harness.channel.emitData(Buffer.from(' world'));

		expect(harness.client.ended).toBe(false);
		expect(harness.channel.ended).toBe(false);

		manager.attach('ticket-1', secondSocket as unknown as WebSocket);
		expect(Buffer.concat(secondSocket.sentBuffers())).toEqual(Buffer.from('lo world'));
	});

	it('trims scrollback across whole chunks and single chunks larger than the limit', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient, scrollbackBytes: 4 });
		const firstSocket = new FakeWebSocket();
		const secondSocket = new FakeWebSocket();
		const thirdSocket = new FakeWebSocket();

		manager.attach(testTicket(), firstSocket as unknown as WebSocket);
		harness.client.emit('ready');
		harness.channel.emitData(Buffer.from('ab'));
		harness.channel.emitData(Buffer.from('cd'));
		harness.channel.emitData(Buffer.from('ef'));
		firstSocket.emitClose();

		manager.attach('ticket-1', secondSocket as unknown as WebSocket);
		expect(Buffer.concat(secondSocket.sentBuffers())).toEqual(Buffer.from('cdef'));
		secondSocket.emitClose();

		harness.channel.emitData(Buffer.from('0123456789'));
		manager.attach('ticket-1', thirdSocket as unknown as WebSocket);
		expect(Buffer.concat(thirdSocket.sentBuffers())).toEqual(Buffer.from('6789'));
	});

	it('does not replay scrollback to a closed websocket', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient, scrollbackBytes: 10 });
		const firstSocket = new FakeWebSocket();
		const closedSocket = new FakeWebSocket();

		manager.attach(testTicket(), firstSocket as unknown as WebSocket);
		harness.client.emit('ready');
		harness.channel.emitData(Buffer.from('output'));
		firstSocket.emitClose();
		closedSocket.readyState = 3;

		manager.attach('ticket-1', closedSocket as unknown as WebSocket);

		expect(closedSocket.sentBuffers()).toEqual([]);
		expect(manager.hasActiveAttachment('ticket-1')).toBe(false);
	});

	it('lets a new attachment take over the active websocket', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const firstSocket = new FakeWebSocket();
		const secondSocket = new FakeWebSocket();

		manager.attach(testTicket(), firstSocket as unknown as WebSocket);
		manager.attach('ticket-1', secondSocket as unknown as WebSocket);

		expect(firstSocket.closed).toEqual({ code: 1000, reason: 'ssh session reattached' });
		expect(secondSocket.closed).toBeUndefined();
	});

	it('rejects missing, closed, and non-SSH live attachments without starting clients', () => {
		expect.assertions(6);

		const createClient = vi.fn(() => new FakeSshClient());
		const manager = new LiveSshManager({ createClient });
		const socket = new FakeWebSocket();

		expect(() => manager.attach('missing-session', socket as unknown as WebSocket)).toThrow(
			LiveSshAttachError
		);
		expect(() => manager.start(testTicket({ protocol: 'vnc' as never }))).toThrow(
			LiveSshAttachError
		);
		expect(createClient).not.toHaveBeenCalled();

		manager.attach(testTicket(), socket as unknown as WebSocket).close();

		expect(manager.get('ticket-1')).toBeUndefined();
		expect(() => manager.attach('ticket-1', new FakeWebSocket() as unknown as WebSocket)).toThrow(
			LiveSshAttachError
		);
		expect(createClient).toHaveBeenCalledTimes(1);
	});

	it('rejects direct attaches to closed sessions and replaces stale closed sessions on restart', () => {
		const clients = [new FakeSshClient(), new FakeSshClient()];
		const createClient = vi.fn(() => clients.shift() ?? new FakeSshClient());
		const manager = new LiveSshManager({ createClient });
		const staleSession = manager.start(testTicket());

		staleSession.close();
		sessionMap(manager).set('ticket-1', staleSession);

		expectAttachError(
			() => manager.attach('ticket-1', new FakeWebSocket() as unknown as WebSocket),
			'session_closed'
		);

		const replacement = manager.start(testTicket());

		expect(replacement).not.toBe(staleSession);
		expect(manager.get('ticket-1')).toBe(replacement);
		expect(createClient).toHaveBeenCalledTimes(2);
	});

	it('cleans up attachment listeners when the returned detach handle is used', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();

		const attachment = manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');

		expect(socket.listenerCount('message')).toBe(1);
		expect(socket.listenerCount('close')).toBe(1);
		expect(socket.listenerCount('error')).toBe(1);

		attachment.detach();
		socket.emitMessage(Buffer.from('ignored\n'), true);
		socket.emitClose();

		expect(socket.listenerCount('message')).toBe(0);
		expect(socket.listenerCount('close')).toBe(0);
		expect(socket.listenerCount('error')).toBe(0);
		expect(manager.hasActiveAttachment('ticket-1')).toBe(false);
		expect(harness.channel.writes).toEqual([]);
		expect(harness.client.ended).toBe(false);
	});

	it('reports detach and close cleanup results for missing, wrong, detached, and closed sessions', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const closeEvents: unknown[] = [];
		manager.onSessionClose((event) => closeEvents.push(event));
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');

		expect(manager.detach('missing-session')).toBe(false);
		expect(manager.detach('ticket-1', new FakeWebSocket() as unknown as WebSocket)).toBe(false);
		expect(manager.detach('ticket-1')).toBe(true);
		expect(manager.detach('ticket-1')).toBe(false);
		expect(manager.close('missing-session')).toBe(false);
		expect(manager.close('ticket-1')).toBe(true);
		expect(manager.close('ticket-1')).toBe(false);
		harness.client.emit('close');

		expect(harness.channel.ended).toBe(true);
		expect(harness.client.ended).toBe(true);
		expect(manager.get('ticket-1')).toBeUndefined();
		expect(closeEvents).toHaveLength(1);
		expect(closeEvents[0]).toMatchObject({ reason: 'explicit', hadActiveAttachment: false });
	});

	it('allows unsubscribing session-close listeners', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const retainedEvents: unknown[] = [];
		const removedEvents: unknown[] = [];
		manager.onSessionClose((event) => retainedEvents.push(event));
		const unsubscribe = manager.onSessionClose((event) => removedEvents.push(event));
		const socket = new FakeWebSocket();

		unsubscribe();
		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		harness.channel.emit('close');

		expect(retainedEvents).toHaveLength(1);
		expect(removedEvents).toEqual([]);
	});

	it('handles resize and explicit close control frames', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		socket.emitMessage(JSON.stringify({ type: 'terminal.resize', cols: 132, rows: 43 }), false);
		socket.emitMessage(JSON.stringify({ type: 'terminal.control', action: 'close' }), false);

		expect(harness.channel.windowUpdates).toEqual([{ rows: 43, cols: 132, height: 0, width: 0 }]);
		expect(harness.channel.ended).toBe(true);
		expect(harness.client.ended).toBe(true);
		expect(socket.closed).toEqual({ code: 1000, reason: 'ssh session closed' });
	});

	it('ignores invalid control frames, handles detach frames, and writes buffered binary arrays', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();
		const secondSocket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		socket.emitMessage('not-json', false);
		socket.emitMessage('[]', false);
		socket.emitMessage('{}', false);
		socket.emitMessage([Buffer.from('a'), Buffer.from('b')], true);
		socket.emitMessage(JSON.stringify({ type: 'terminal.control', action: 'detach' }), false);
		socket.emitMessage(Buffer.from('ignored'), true);

		expect(harness.channel.writes).toEqual([Buffer.from('a'), Buffer.from('b')]);
		expect(manager.hasActiveAttachment('ticket-1')).toBe(false);

		manager.attach('ticket-1', secondSocket as unknown as WebSocket);
		secondSocket.emitMessage(JSON.stringify({ type: 'terminal.close' }), false);

		expect(secondSocket.closed).toEqual({ code: 1000, reason: 'ssh session closed' });
		expect(manager.get('ticket-1')).toBeUndefined();
	});

	it('ignores resize and input frames after explicit close', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		socket.emitMessage(JSON.stringify({ type: 'terminal.control', action: 'close' }), false);
		socket.emitMessage(JSON.stringify({ type: 'terminal.resize', cols: 132, rows: 43 }), false);
		socket.emitMessage(Buffer.from('whoami\n'), true);

		expect(harness.channel.windowUpdates).toEqual([]);
		expect(harness.channel.writes).toEqual([]);
		expect(socket.closed).toEqual({ code: 1000, reason: 'ssh session closed' });
	});

	it('detaches websocket errors without ending the remote shell', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		socket.emitError(new Error('browser socket failed'));
		harness.channel.emitData(Buffer.from('detached output'));

		expect(manager.get('ticket-1')).toBeDefined();
		expect(manager.hasActiveAttachment('ticket-1')).toBe(false);
		expect(harness.client.ended).toBe(false);
		expect(harness.channel.ended).toBe(false);
		expect(socket.sentBuffers()).toEqual([]);
	});

	it('treats client close and end during startup as remote session closure', () => {
		for (const eventName of ['close', 'end'] as const) {
			const harness = createHarness();
			const manager = new LiveSshManager({ createClient: harness.createClient });
			const closeEvents: unknown[] = [];
			manager.onSessionClose((event) => closeEvents.push(event));
			const socket = new FakeWebSocket();

			manager.attach(
				testTicket({ ticketId: `ticket-${eventName}` }),
				socket as unknown as WebSocket
			);
			harness.client.emit(eventName);

			expect(manager.get(`ticket-${eventName}`)).toBeUndefined();
			expect(harness.client.ended).toBe(false);
			expect(socket.closed).toEqual({ code: 1000, reason: 'ssh shell closed' });
			expect(closeEvents).toEqual([
				{
					sessionId: `ticket-${eventName}`,
					userId: 'user-1',
					reason: 'remote',
					hadActiveAttachment: true
				}
			]);
		}
	});

	it('closes the attached websocket when the remote shell closes', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const closeEvents: unknown[] = [];
		manager.onSessionClose((event) => closeEvents.push(event));
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		harness.channel.emit('close');

		expect(socket.closed).toEqual({ code: 1000, reason: 'ssh shell closed' });
		expect(manager.get('ticket-1')).toBeUndefined();
		expect(closeEvents).toEqual([
			{
				sessionId: 'ticket-1',
				userId: 'user-1',
				reason: 'remote',
				hadActiveAttachment: true
			}
		]);
	});

	it('emits detached remote shell closure for persistence', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const closeEvents: unknown[] = [];
		manager.onSessionClose((event) => closeEvents.push(event));
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		socket.emitClose();
		harness.channel.emit('close');

		expect(manager.get('ticket-1')).toBeUndefined();
		expect(closeEvents).toEqual([
			{
				sessionId: 'ticket-1',
				userId: 'user-1',
				reason: 'remote',
				hadActiveAttachment: false
			}
		]);
	});

	it('closes once when the remote shell ends after an explicit close', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const closeEvents: unknown[] = [];
		manager.onSessionClose((event) => closeEvents.push(event));
		const socket = new FakeWebSocket();

		const attachment = manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		attachment.close();
		harness.channel.emit('end');

		expect(closeEvents).toHaveLength(1);
		expect(closeEvents[0]).toMatchObject({ reason: 'explicit' });
	});

	it('ends the ssh client when shell allocation fails', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();

		harness.client.shellError = new Error('allocation failed');
		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');

		expect(socket.closed).toEqual({ code: 1011, reason: 'ssh shell failed' });
		expect(harness.client.ended).toBe(true);
		expect(manager.get('ticket-1')).toBeUndefined();
	});

	it('closes the active attachment and emits a connection failure when SSH connect fails', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const closeEvents: unknown[] = [];
		manager.onSessionClose((event) => closeEvents.push(event));
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('error', new Error('ECONNRESET'));

		expect(socket.closed).toEqual({ code: 1011, reason: 'ssh connection failed' });
		expect(harness.client.ended).toBe(true);
		expect(manager.get('ticket-1')).toBeUndefined();
		expect(closeEvents).toEqual([
			{
				sessionId: 'ticket-1',
				userId: 'user-1',
				reason: 'connection_error',
				hadActiveAttachment: false
			}
		]);
	});

	it('closes the active attachment and emits shell_error when the shell stream fails', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const closeEvents: unknown[] = [];
		manager.onSessionClose((event) => closeEvents.push(event));
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		harness.channel.emit('error', new Error('shell stream failed'));

		expect(socket.closed).toEqual({ code: 1011, reason: 'ssh shell failed' });
		expect(harness.client.ended).toBe(true);
		expect(manager.get('ticket-1')).toBeUndefined();
		expect(closeEvents).toEqual([
			{
				sessionId: 'ticket-1',
				userId: 'user-1',
				reason: 'shell_error',
				hadActiveAttachment: false
			}
		]);
	});

	it('ends a trusted jump-host client if the live session closes before startup resolves', async () => {
		const initialClient = new FakeSshClient();
		const trustedClient = new FakeSshClient();
		const manager = new LiveSshManager({ createClient: () => initialClient });
		let resolveTrustedClient: (client: FakeSshClient) => void = () => {};
		mockedConnectTrustedSsh.mockReturnValue(
			new Promise((resolve) => {
				resolveTrustedClient = (client) => resolve(client as never);
			}) as ReturnType<typeof connectTrustedSsh>
		);

		const session = manager.start(jumpTicket());
		session.close();
		resolveTrustedClient(trustedClient);
		await vi.waitFor(() => expect(trustedClient.ended).toBe(true));

		expect(trustedClient.ended).toBe(true);
		expect(trustedClient.shellOptions).toBeUndefined();
		expect(manager.get('ticket-1')).toBeUndefined();
	});

	it('opens a shell through a trusted jump-host client and handles trusted-client errors', async () => {
		const initialClient = new FakeSshClient();
		const trustedClient = new FakeSshClient();
		const manager = new LiveSshManager({ createClient: () => initialClient });
		const closeEvents: unknown[] = [];
		manager.onSessionClose((event) => closeEvents.push(event));
		const socket = new FakeWebSocket();
		mockedConnectTrustedSsh.mockResolvedValue(trustedClient as never);

		manager.attach(jumpTicket(), socket as unknown as WebSocket);
		await vi.waitFor(() =>
			expect(trustedClient.shellOptions).toMatchObject({ cols: 80, rows: 24 })
		);
		trustedClient.emit('error', new Error('jump target failed'));

		expect(initialClient.ended).toBe(false);
		expect(trustedClient.ended).toBe(true);
		expect(socket.closed).toEqual({ code: 1011, reason: 'ssh connection failed' });
		expect(closeEvents).toEqual([
			{
				sessionId: 'ticket-1',
				userId: 'user-1',
				reason: 'connection_error',
				hadActiveAttachment: false
			}
		]);
	});

	it('closes the active attachment with a trust error when jump-host connection fails trust', async () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();
		mockedConnectTrustedSsh.mockImplementation(async (_target, options) => {
			options?.onHostKeyTrustFailure?.(new Error('host key changed') as never);
			throw new Error('host key changed');
		});

		manager.attach(jumpTicket(), socket as unknown as WebSocket);

		await vi.waitFor(() =>
			expect(socket.closed).toEqual({ code: 1011, reason: 'ssh host key not trusted' })
		);
		expect(harness.client.ended).toBe(true);
		expect(manager.get('ticket-1')).toBeUndefined();
	});
});

class FakeSshClient extends EventEmitter implements LiveSshClient {
	ended = false;
	shellError: Error | undefined;
	shellOptions: unknown;
	connectConfig: unknown;
	readonly channel = new FakeSshChannel();

	connect(config: unknown): void {
		this.connectConfig = config;
	}

	shell(
		options: never,
		callback: (error: Error | undefined, stream: LiveSshChannel) => void
	): void {
		this.shellOptions = options;
		callback(this.shellError, this.channel);
	}

	end(): void {
		this.ended = true;
	}
}

class FakeSshChannel extends EventEmitter implements LiveSshChannel {
	ended = false;
	readonly writes: Buffer[] = [];
	readonly windowUpdates: Array<{ rows: number; cols: number; height: number; width: number }> = [];

	write(chunk: Buffer): void {
		this.writes.push(chunk);
	}

	setWindow(rows: number, cols: number, height: number, width: number): void {
		this.windowUpdates.push({ rows, cols, height, width });
	}

	end(): void {
		this.ended = true;
	}

	emitData(chunk: Buffer): void {
		this.emit('data', chunk);
	}
}

class FakeWebSocket extends EventEmitter {
	readonly OPEN = 1;
	readyState = this.OPEN;
	closed: { code: number; reason: string } | undefined;
	private readonly sent: Buffer[] = [];

	send(chunk: Buffer): void {
		this.sent.push(Buffer.from(chunk));
	}

	close(code = 1000, reason = ''): void {
		this.closed = { code, reason };
		this.readyState = 3;
	}

	emitMessage(data: Buffer | ArrayBuffer | Buffer[] | string, isBinary: boolean): void {
		this.emit('message', data, isBinary);
	}

	emitClose(): void {
		this.readyState = 3;
		this.emit('close', 1000);
	}

	emitError(error: Error): void {
		this.emit('error', error);
	}

	sentBuffers(): Buffer[] {
		return this.sent;
	}
}

function createHarness(): {
	client: FakeSshClient;
	channel: FakeSshChannel;
	createClient: () => LiveSshClient;
} {
	const client = new FakeSshClient();
	return {
		client,
		channel: client.channel,
		createClient: () => client
	};
}

function testTicket(overrides: Partial<ConsumedTicket> = {}): ConsumedTicket {
	return {
		ticketId: 'ticket-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ssh',
		target: {
			host: 'example.test',
			port: 22,
			username: 'alice',
			credential: {
				kind: 'password',
				username: 'alice',
				password: 'secret'
			}
		},
		...overrides
	};
}

function jumpTicket(overrides: Partial<ConsumedTicket> = {}): ConsumedTicket {
	return testTicket({
		target: {
			...testTicket().target,
			jumpHost: { hostId: 'jump-host-1' }
		},
		...overrides
	});
}

function sessionMap(manager: LiveSshManager): Map<string, LiveSshSession> {
	return (
		manager as unknown as {
			sessions: Map<string, LiveSshSession>;
		}
	).sessions;
}

function expectAttachError(fn: () => LiveSshAttachResult, code: LiveSshAttachError['code']): void {
	try {
		fn();
		throw new Error('Expected LiveSshAttachError');
	} catch (error) {
		expect(error).toBeInstanceOf(LiveSshAttachError);
		expect((error as LiveSshAttachError).code).toBe(code);
	}
}
