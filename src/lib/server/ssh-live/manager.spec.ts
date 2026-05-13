import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { LiveSshManager, type LiveSshChannel, type LiveSshClient } from './manager';
import type { ConsumedTicket } from '../protocols/types';

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

	it('closes the attached websocket when the remote shell closes', () => {
		const harness = createHarness();
		const manager = new LiveSshManager({ createClient: harness.createClient });
		const socket = new FakeWebSocket();

		manager.attach(testTicket(), socket as unknown as WebSocket);
		harness.client.emit('ready');
		harness.channel.emit('close');

		expect(socket.closed).toEqual({ code: 1000, reason: 'ssh shell closed' });
		expect(manager.get('ticket-1')).toBeUndefined();
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
});

class FakeSshClient extends EventEmitter implements LiveSshClient {
	ended = false;
	shellError: Error | undefined;
	shellOptions: unknown;
	readonly channel = new FakeSshChannel();

	connect(): void {}

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

	emitMessage(data: Buffer | string, isBinary: boolean): void {
		this.emit('message', data, isBinary);
	}

	emitClose(): void {
		this.readyState = 3;
		this.emit('close', 1000);
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

function testTicket(): ConsumedTicket {
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
		}
	};
}
