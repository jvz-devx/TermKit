import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSshAdapter } from './ssh';
import type { ConsumedTicket } from './types';

const sshConnectMocks = vi.hoisted(() => ({
	connectTrustedSsh: vi.fn()
}));

vi.mock('./ssh-connect', () => ({
	connectTrustedSsh: sshConnectMocks.connectTrustedSsh
}));

beforeEach(() => {
	sshConnectMocks.connectTrustedSsh.mockReset();
});

describe('SSH protocol adapter', () => {
	it('applies resize controls before shell creation and proxies shell bytes', async () => {
		expect.assertions(6);

		let resolveConnection!: (connection: FakeSshConnection) => void;
		sshConnectMocks.connectTrustedSsh.mockReturnValue(
			new Promise((resolve) => {
				resolveConnection = resolve;
			})
		);
		const adapter = createSshAdapter();
		const socket = new FakeWebSocket();
		const connection = new FakeSshConnection();

		const handling = adapter.handle(socket as never, ticket());
		socket.emit('message', '{"type":"terminal.resize","cols":132,"rows":43}', false);
		resolveConnection(connection);
		await handling;
		const stream = new FakeShellStream();
		connection.resolveShell(undefined, stream);

		socket.emit('message', Buffer.from('whoami'), true);
		stream.emit('data', Buffer.from('root\n'));
		stream.emit('close');
		socket.emit('close');

		expect(connection.shell).toHaveBeenCalledWith(
			{ term: 'xterm-256color', cols: 132, rows: 43, width: 0, height: 0 },
			expect.any(Function)
		);
		expect(stream.write).toHaveBeenCalledWith(Buffer.from('whoami'));
		expect(socket.send).toHaveBeenCalledWith(Buffer.from('root\n'));
		expect(socket.close).toHaveBeenCalledWith(1000, 'ssh shell closed');
		expect(connection.end).toHaveBeenCalledTimes(1);
		expect(sshConnectMocks.connectTrustedSsh).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user-1',
				hostId: 'host-1',
				username: 'credential-user'
			}),
			expect.objectContaining({ onHostKeyTrustFailure: expect.any(Function) })
		);
	});

	it('updates an open shell window from resize controls and writes chunked websocket messages', async () => {
		expect.assertions(3);

		const connection = new FakeSshConnection();
		const stream = new FakeShellStream();
		const socket = new FakeWebSocket();
		sshConnectMocks.connectTrustedSsh.mockResolvedValue(connection);

		await createSshAdapter().handle(socket as never, ticket());
		connection.resolveShell(undefined, stream);
		socket.emit('message', '{"type":"terminal.resize","cols":100,"rows":30}', false);
		socket.emit('message', [Buffer.from('A'), Buffer.from('B')], true);

		expect(stream.setWindow).toHaveBeenCalledWith(30, 100, 0, 0);
		expect(stream.write).toHaveBeenNthCalledWith(1, Buffer.from('A'));
		expect(stream.write).toHaveBeenNthCalledWith(2, Buffer.from('B'));
	});

	it('closes with host-key-specific reason when trust validation fails', async () => {
		expect.assertions(1);

		const socket = new FakeWebSocket();
		sshConnectMocks.connectTrustedSsh.mockImplementation(async (_target, options) => {
			const error = new Error('untrusted');
			error.name = 'SshHostKeyTrustError';
			options.onHostKeyTrustFailure(error);
			throw error;
		});

		await createSshAdapter().handle(socket as never, ticket());

		expect(socket.close).toHaveBeenCalledWith(1011, 'ssh host key not trusted');
	});
});

function ticket(): ConsumedTicket {
	return {
		ticketId: 'ticket-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ssh',
		target: {
			host: 'shell.example.test',
			port: 22,
			username: 'host-user',
			credential: {
				kind: 'password',
				username: 'credential-user',
				password: 'secret'
			}
		}
	};
}

class FakeWebSocket extends EventEmitter {
	readonly OPEN = 1;
	readyState = this.OPEN;
	send = vi.fn();
	close = vi.fn();
}

class FakeSshConnection extends EventEmitter {
	end = vi.fn();
	shell = vi.fn(
		(_options: unknown, callback: (error: Error | undefined, stream?: FakeShellStream) => void) => {
			this.shellCallback = callback;
		}
	);
	private shellCallback?: (error: Error | undefined, stream?: FakeShellStream) => void;

	resolveShell(error: Error | undefined, stream?: FakeShellStream) {
		this.shellCallback?.(error, stream);
	}
}

class FakeShellStream extends EventEmitter {
	write = vi.fn();
	setWindow = vi.fn();
}
