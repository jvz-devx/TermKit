import { describe, expect, it } from 'vitest';
import {
	buildForwardHttpRequest,
	parseForwardHttpResponse,
	tunnelFailureCode,
	SshTunnelProxyError
} from './ssh-tunnel';
import { ServiceValidationError } from '../services/errors';

describe('ssh-tunnel protocol helpers', () => {
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
});
