import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildForwardHttpRequest,
	parseForwardHttpResponse,
	proxyHttpTunnelRequest,
	proxyTcpTunnelWebSocket,
	tunnelFailureCode,
	SshTunnelProxyError
} from './ssh-tunnel';
import { ServicePayloadTooLargeError, ServiceValidationError } from '../services/errors';

const sshConnectMocks = vi.hoisted(() => ({
	connectTrustedSsh: vi.fn()
}));

vi.mock('./ssh-connect', () => ({
	connectTrustedSsh: sshConnectMocks.connectTrustedSsh
}));

describe('ssh-tunnel protocol helpers', () => {
	beforeEach(() => {
		sshConnectMocks.connectTrustedSsh.mockReset();
	});

	it('builds origin-form HTTP requests without forwarding app credentials', () => {
		const request = new Request('https://termix.test/api/tunnels/session-1/proxy/admin', {
			method: 'POST',
			headers: {
				accept: 'application/json',
				authorization: 'Bearer app-token',
				cookie: 'session=secret',
				connection: 'keep-alive',
				'content-length': '999',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ ok: true })
		});

		const raw = buildForwardHttpRequest({
			request,
			path: '/admin?tab=status',
			targetHost: '127.0.0.1',
			targetPort: 8080,
			body: new TextEncoder().encode('{"ok":true}')
		}).toString('utf8');

		expect(raw).toContain('POST /admin?tab=status HTTP/1.1\r\n');
		expect(raw).toContain('Host: 127.0.0.1:8080\r\n');
		expect(raw).toContain('accept: application/json\r\n');
		expect(raw).toContain('content-type: application/json\r\n');
		expect(raw).toContain('Content-Length: 11\r\n');
		expect(raw).not.toContain('authorization');
		expect(raw).not.toContain('content-length: 999');
		expect(raw).not.toContain('cookie');
		expect(raw.endsWith('\r\n\r\n{"ok":true}')).toBe(true);
	});

	it('builds slash-prefixed requests with bracketed IPv6 host headers and no GET body', () => {
		const request = new Request('https://termix.test/proxy', {
			method: 'GET',
			headers: { accept: 'text/plain', upgrade: 'websocket' }
		});

		const raw = buildForwardHttpRequest({
			request,
			path: 'healthz',
			targetHost: '2001:db8::10',
			targetPort: 80,
			body: new Uint8Array()
		}).toString('utf8');

		expect(raw).toBe(
			[
				'GET /healthz HTTP/1.1',
				'Host: [2001:db8::10]',
				'accept: text/plain',
				'Connection: close',
				'',
				''
			].join('\r\n')
		);
	});

	it('parses forwarded HTTP responses and strips hop-by-hop headers', () => {
		const response = parseForwardHttpResponse(
			Buffer.from(
				[
					'HTTP/1.1 201 Created',
					'Content-Type: application/json',
					'Connection: close',
					'Transfer-Encoding: chunked',
					'X-Upstream: internal',
					'',
					'{"created":true}'
				].join('\r\n')
			)
		);

		expect(response.status).toBe(201);
		expect(response.statusText).toBe('Created');
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(response.headers.get('connection')).toBeNull();
		expect(response.headers.get('transfer-encoding')).toBeNull();
		expect(response.headers.get('x-upstream')).toBe('internal');
		expect(new TextDecoder().decode(new Uint8Array(response.body))).toBe('{"created":true}');
	});

	it('rejects malformed forwarded HTTP responses with structured proxy errors', () => {
		expect(() =>
			parseForwardHttpResponse(Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain'))
		).toThrow(SshTunnelProxyError);

		try {
			parseForwardHttpResponse(Buffer.from('NOPE 200 OK\r\n\r\nbody'));
		} catch (error) {
			expect(error).toBeInstanceOf(SshTunnelProxyError);
			expect(error).toMatchObject({
				code: 'tunnel_proxy_failed',
				message: 'Tunnel target returned an invalid status line'
			});
		}
	});

	it('keeps repeated upstream headers while still stripping hop-by-hop headers', () => {
		const response = parseForwardHttpResponse(
			Buffer.from(
				[
					'HTTP/1.0 204',
					'Set-Cookie: one=1',
					'Set-Cookie: two=2',
					'Proxy-Authenticate: Basic realm="internal"',
					'',
					''
				].join('\r\n')
			)
		);

		expect(response.status).toBe(204);
		expect(response.statusText).toBe('');
		expect(response.headers.get('set-cookie')).toContain('one=1');
		expect(response.headers.get('set-cookie')).toContain('two=2');
		expect(response.headers.get('proxy-authenticate')).toBeNull();
	});

	it('maps protocol errors to structured tunnel failure codes', () => {
		expect(tunnelFailureCode(new SshTunnelProxyError('ssh_auth_failed'))).toBe('ssh_auth_failed');
		expect(tunnelFailureCode(new ServiceValidationError(['bad input']))).toBe('validation_failed');
		expect(tunnelFailureCode(new Error('boom'))).toBe('tunnel_proxy_failed');
	});

	it('rejects oversized HTTP tunnel requests before opening SSH connections', async () => {
		expect.assertions(2);

		const request = new Request('https://termix.test/api/tunnels/session-1/proxy/upload', {
			method: 'POST',
			headers: { 'content-length': String(25 * 1024 * 1024 + 1) },
			body: 'x'
		});

		await expect(
			proxyHttpTunnelRequest(
				sshTarget(),
				{ targetHost: '127.0.0.1', targetPort: 8080 },
				request,
				'/upload'
			)
		).rejects.toBeInstanceOf(ServicePayloadTooLargeError);
		expect(sshConnectMocks.connectTrustedSsh).not.toHaveBeenCalled();
	});

	it('maps SSH connection failures to tunnel proxy failure codes', async () => {
		expect.assertions(3);

		sshConnectMocks.connectTrustedSsh
			.mockRejectedValueOnce(Object.assign(new Error('denied'), { level: 'client-authentication' }))
			.mockRejectedValueOnce(
				Object.assign(new Error('changed key'), { name: 'SshHostKeyTrustError' })
			)
			.mockRejectedValueOnce(new Error('network unreachable'));
		const request = () => new Request('https://termix.test/proxy', { method: 'GET' });
		const proxy = () =>
			proxyHttpTunnelRequest(
				sshTarget(),
				{ targetHost: '127.0.0.1', targetPort: 8080 },
				request(),
				'/'
			);

		await expect(proxy()).rejects.toMatchObject({ code: 'ssh_auth_failed' });
		await expect(proxy()).rejects.toMatchObject({ code: 'ssh_host_key_untrusted' });
		await expect(proxy()).rejects.toMatchObject({
			code: 'ssh_connection_failed',
			message: 'network unreachable'
		});
	});

	it('proxies HTTP tunnel requests over the forwarded channel and ends the SSH connection', async () => {
		expect.assertions(6);

		const channel = new FakeSshChannel();
		channel.end = vi.fn((data: Buffer) => {
			expect(data.toString('utf8')).toContain('GET /status HTTP/1.1\r\n');
			channel.emit(
				'data',
				Buffer.from(['HTTP/1.1 202 Accepted', 'X-Upstream: ok', '', 'queued'].join('\r\n'))
			);
			channel.emit('close');
		});
		const connection = new FakeSshConnection(channel);
		sshConnectMocks.connectTrustedSsh.mockResolvedValue(connection);

		const response = await proxyHttpTunnelRequest(
			sshTarget(),
			{ targetHost: '127.0.0.1', targetPort: 8080 },
			new Request('https://termix.test/proxy', { method: 'GET' }),
			'/status'
		);

		expect(response.status).toBe(202);
		expect(response.statusText).toBe('Accepted');
		expect(response.headers.get('x-upstream')).toBe('ok');
		expect(new TextDecoder().decode(response.body)).toBe('queued');
		expect(connection.end).toHaveBeenCalledTimes(1);
	});

	it('cleans channel listeners and ends SSH connections when HTTP tunnel writes fail', async () => {
		expect.assertions(5);

		const channel = new FakeSshChannel();
		channel.end = vi.fn(() => {
			channel.emit('error', new Error('broken pipe'));
		});
		const connection = new FakeSshConnection(channel);
		sshConnectMocks.connectTrustedSsh.mockResolvedValue(connection);

		await expect(
			proxyHttpTunnelRequest(
				sshTarget(),
				{ targetHost: '127.0.0.1', targetPort: 8080 },
				new Request('https://termix.test/proxy', { method: 'GET' }),
				'/status'
			)
		).rejects.toMatchObject({ code: 'tunnel_proxy_failed', message: 'broken pipe' });
		expect(connection.end).toHaveBeenCalledTimes(1);
		expect(channel.listenerCount('data')).toBe(0);
		expect(channel.listenerCount('close')).toBe(0);
		expect(channel.listenerCount('error')).toBe(0);
	});

	it('proxies websocket bytes through an SSH forwarded channel and cleans up on socket close', async () => {
		expect.assertions(10);

		const channel = new FakeSshChannel();
		const connection = new FakeSshConnection(channel);
		const socket = new FakeWebSocket();
		sshConnectMocks.connectTrustedSsh.mockResolvedValue(connection);

		await proxyTcpTunnelWebSocket(
			sshTarget(),
			{ targetHost: 'database.internal.test', targetPort: 5432 },
			socket as never
		);

		socket.emit('message', Buffer.from('client-bytes'));
		socket.emit('message', new Uint8Array([1, 2, 3]).buffer);
		socket.emit('message', [Buffer.from('A'), Buffer.from('B')]);
		channel.emit('data', Buffer.from('server-bytes'));
		socket.emit('close');

		expect(connection.forwardOut).toHaveBeenCalledWith(
			'127.0.0.1',
			0,
			'database.internal.test',
			5432,
			expect.any(Function)
		);
		expect(channel.write).toHaveBeenCalledWith(Buffer.from('client-bytes'));
		expect(channel.write).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
		expect(channel.write).toHaveBeenCalledWith(Buffer.from('AB'));
		expect(socket.send).toHaveBeenCalledWith(Buffer.from('server-bytes'));
		expect(channel.end).toHaveBeenCalledTimes(1);
		expect(connection.end).toHaveBeenCalledTimes(1);
		expect(socket.listenerCount('message')).toBe(0);
		expect(channel.listenerCount('data')).toBe(0);
		expect(channel.listenerCount('close')).toBe(0);
	});

	it('closes the websocket with a target failure when the forwarded channel errors', async () => {
		expect.assertions(5);

		const channel = new FakeSshChannel();
		const connection = new FakeSshConnection(channel);
		const socket = new FakeWebSocket();
		sshConnectMocks.connectTrustedSsh.mockResolvedValue(connection);

		await proxyTcpTunnelWebSocket(
			sshTarget(),
			{ targetHost: '127.0.0.1', targetPort: 80 },
			socket as never
		);
		channel.emit('error', new Error('upstream reset'));

		expect(socket.close).toHaveBeenCalledWith(1011, 'tunnel target failed');
		expect(connection.end).toHaveBeenCalledTimes(1);
		expect(socket.listenerCount('message')).toBe(0);
		expect(channel.listenerCount('data')).toBe(0);
		expect(channel.listenerCount('error')).toBe(0);
	});

	it('ends the SSH connection when the forwarded channel cannot be opened', async () => {
		expect.assertions(3);

		const channel = new FakeSshChannel();
		const connection = new FakeSshConnection(channel, new Error('connection refused'));
		const socket = new FakeWebSocket();
		sshConnectMocks.connectTrustedSsh.mockResolvedValue(connection);

		await expect(
			proxyTcpTunnelWebSocket(
				sshTarget(),
				{ targetHost: '127.0.0.1', targetPort: 80 },
				socket as never
			)
		).rejects.toMatchObject({
			code: 'target_unreachable',
			message: 'connection refused'
		});
		expect(connection.end).toHaveBeenCalledTimes(1);
		expect(socket.listenerCount('message')).toBe(0);
	});

	it('destroys the forwarded channel and removes listeners when the websocket errors', async () => {
		expect.assertions(5);

		const channel = new FakeSshChannel();
		const connection = new FakeSshConnection(channel);
		const socket = new FakeWebSocket();
		sshConnectMocks.connectTrustedSsh.mockResolvedValue(connection);

		await proxyTcpTunnelWebSocket(
			sshTarget(),
			{ targetHost: '127.0.0.1', targetPort: 80 },
			socket as never
		);
		socket.emit('error', new Error('socket reset'));

		expect(channel.destroy).toHaveBeenCalledTimes(1);
		expect(connection.end).toHaveBeenCalledTimes(1);
		expect(socket.listenerCount('message')).toBe(0);
		expect(channel.listenerCount('data')).toBe(0);
		expect(channel.listenerCount('error')).toBe(0);
	});
});

function sshTarget() {
	return {
		userId: 'user-1',
		hostId: 'host-1',
		host: 'shell.example.test',
		port: 22,
		username: 'ops'
	};
}

class FakeWebSocket extends EventEmitter {
	readonly OPEN = 1;
	readyState = this.OPEN;
	send = vi.fn();
	close = vi.fn((code?: number, reason?: string) => {
		this.readyState = 3;
		this.emit('close', code, Buffer.from(reason ?? ''));
	});
}

class FakeSshChannel extends EventEmitter {
	destroyed = false;
	write = vi.fn();
	end = vi.fn();
	destroy = vi.fn(() => {
		this.destroyed = true;
	});
}

class FakeSshConnection {
	end = vi.fn();
	forwardOut = vi.fn(
		(
			_sourceHost: string,
			_sourcePort: number,
			_targetHost: string,
			_targetPort: number,
			callback: (error: Error | undefined, channel?: FakeSshChannel) => void
		) => callback(this.forwardError, this.channel)
	);

	constructor(
		private readonly channel: FakeSshChannel,
		private readonly forwardError?: Error
	) {}
}
