import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTermixServer, type GatewayProxySessionAuthenticator } from '../../../server';

const servers: HttpServer[] = [];

afterEach(async () => {
	await Promise.all(servers.map(closeServer));
	servers.length = 0;
});

describe('Gateway proxy hardening', () => {
	it('requires an authenticated app session before proxying Gateway HTTP requests', async () => {
		expect.assertions(3);

		const gateway = await startGatewayFixture();
		const app = await startAppServer(gateway.url);

		const response = await fetch(serverUrl(app.server, '/gateway/jet/rdp'), {
			headers: { Origin: 'https://termix.example' }
		});

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
		expect(gateway.requests).toHaveLength(0);
	});

	it('applies the production Origin policy before Gateway HTTP proxying', async () => {
		expect.assertions(4);

		const gateway = await startGatewayFixture();
		let authCalls = 0;
		const app = await startAppServer(gateway.url, async () => {
			authCalls += 1;
			return { sessionId: 'session-1', userId: 'user-1' };
		});

		const response = await fetch(serverUrl(app.server, '/gateway/jet/rdp'), {
			headers: {
				Origin: 'https://evil.example',
				Cookie: 'termixkit_session=valid'
			}
		});

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({ error: 'Gateway origin is not allowed' });
		expect(authCalls).toBe(0);
		expect(gateway.requests).toHaveLength(0);
	});

	it('proxies only the authenticated RDP JET HTTP path and does not forward app cookies', async () => {
		expect.assertions(7);

		const gateway = await startGatewayFixture();
		const app = await startAppServer(gateway.url);

		const response = await fetch(serverUrl(app.server, '/gateway/jet/rdp?association=1'), {
			headers: {
				Origin: 'https://termix.example',
				Cookie: 'termixkit_session=valid'
			}
		});
		const rejectedPost = await fetch(serverUrl(app.server, '/gateway/jet/rdp'), {
			method: 'POST',
			headers: {
				Origin: 'https://termix.example',
				Cookie: 'termixkit_session=valid'
			}
		});
		const rejectedProvisioningPath = await fetch(
			serverUrl(app.server, '/gateway/jet/webapp/app-token'),
			{
				headers: {
					Origin: 'https://termix.example',
					Cookie: 'termixkit_session=valid'
				}
			}
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(gateway.requests).toHaveLength(1);
		expect(gateway.requests[0]).toMatchObject({ method: 'GET', url: '/jet/rdp?association=1' });
		expect(gateway.requests[0]?.headers.cookie).toBeUndefined();
		expect(rejectedPost.status).toBe(405);
		expect(rejectedProvisioningPath.status).toBe(404);
	});

	it('requires an authenticated app session before proxying Gateway upgrades', async () => {
		expect.assertions(2);

		const gateway = await startGatewayFixture();
		const app = await startAppServer(gateway.url);

		const response = await rawUpgrade(app.server, '/gateway/jet/rdp', {
			Origin: 'https://termix.example'
		});

		expect(response).toContain('401 Authentication required');
		expect(gateway.upgrades).toHaveLength(0);
	});

	it('applies the production Origin policy before Gateway upgrades', async () => {
		expect.assertions(3);

		const gateway = await startGatewayFixture();
		let authCalls = 0;
		const app = await startAppServer(gateway.url, async () => {
			authCalls += 1;
			return { sessionId: 'session-1', userId: 'user-1' };
		});

		const response = await rawUpgrade(app.server, '/gateway/jet/rdp', {
			Origin: 'https://evil.example',
			Cookie: 'termixkit_session=valid'
		});

		expect(response).toContain('403 Gateway origin is not allowed');
		expect(authCalls).toBe(0);
		expect(gateway.upgrades).toHaveLength(0);
	});

	it('proxies only authenticated RDP JET upgrades and does not forward app cookies', async () => {
		expect.assertions(5);

		const gateway = await startGatewayFixture();
		const app = await startAppServer(gateway.url);

		const accepted = await rawUpgrade(app.server, '/gateway/jet/rdp?association=1', {
			Origin: 'https://termix.example',
			Cookie: 'termixkit_session=valid'
		});
		const rejectedProvisioningPath = await rawUpgrade(app.server, '/gateway/jet/webapp/app-token', {
			Origin: 'https://termix.example',
			Cookie: 'termixkit_session=valid'
		});

		expect(accepted).toContain('101 Switching Protocols');
		expect(accepted).toContain('x-gateway-test: accepted');
		expect(gateway.upgrades).toHaveLength(1);
		expect(gateway.upgrades[0]).toMatchObject({ method: 'GET', url: '/jet/rdp?association=1' });
		expect(rejectedProvisioningPath).toContain('404 Gateway route is not available');
	});
});

async function startAppServer(
	gatewayUrl: string,
	gatewaySessionAuthenticator: GatewayProxySessionAuthenticator = testSessionAuthenticator
): Promise<{ server: HttpServer }> {
	const server = createTermixServer({
		env: {
			BODY_SIZE_LIMIT: '512K',
			GATEWAY_URL: gatewayUrl,
			NODE_ENV: 'production',
			ORIGIN: 'https://termix.example'
		},
		gatewaySessionAuthenticator,
		handler(_request, response) {
			response.writeHead(404, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ error: 'not found' }));
		}
	});
	servers.push(server);
	await listen(server);
	return { server };
}

async function startGatewayFixture(): Promise<{
	server: HttpServer;
	url: string;
	requests: GatewayRequest[];
	upgrades: GatewayRequest[];
}> {
	const requests: GatewayRequest[] = [];
	const upgrades: GatewayRequest[] = [];
	const server = createServer((request, response) => {
		requests.push(captureGatewayRequest(request));
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ ok: true }));
	});
	server.on('upgrade', (request, socket) => {
		upgrades.push(captureGatewayRequest(request));
		socket.write(
			'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nx-gateway-test: accepted\r\n\r\n'
		);
		socket.end();
	});
	servers.push(server);
	await listen(server);

	return {
		server,
		url: serverUrl(server, '/'),
		requests,
		upgrades
	};
}

function captureGatewayRequest(request: IncomingMessage): GatewayRequest {
	return {
		method: request.method ?? 'GET',
		url: request.url ?? '/',
		headers: request.headers
	};
}

const testSessionAuthenticator: GatewayProxySessionAuthenticator = async (request) => {
	const cookies = Array.isArray(request.headers.cookie)
		? request.headers.cookie
		: request.headers.cookie
			? [request.headers.cookie]
			: [];

	return cookies.some((cookie) => cookie.includes('termixkit_session=valid'))
		? { sessionId: 'session-1', userId: 'user-1' }
		: null;
};

function rawUpgrade(
	server: HttpServer,
	path: string,
	headers: Record<string, string> = {}
): Promise<string> {
	return new Promise((resolve, reject) => {
		const address = server.address() as AddressInfo;
		const socket = connect(address.port, address.address);
		let response = '';
		let settled = false;

		const settle = (value: string) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		socket.setEncoding('utf8');
		socket.on('data', (chunk) => {
			response += chunk;
		});
		socket.on('end', () => settle(response));
		socket.on('close', () => settle(response));
		socket.on('error', reject);
		socket.on('connect', () => {
			const requestHeaders = {
				Host: `${address.address}:${address.port}`,
				Upgrade: 'websocket',
				Connection: 'Upgrade',
				'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
				'Sec-WebSocket-Version': '13',
				...headers
			};
			socket.write(
				[
					`GET ${path} HTTP/1.1`,
					...Object.entries(requestHeaders).map(([key, value]) => `${key}: ${value}`),
					'\r\n'
				].join('\r\n')
			);
		});
	});
}

function listen(server: HttpServer): Promise<void> {
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
}

function closeServer(server: HttpServer): Promise<void> {
	return new Promise((resolve, reject) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

function serverUrl(server: HttpServer, path: string): string {
	const address = server.address() as AddressInfo;
	return `http://127.0.0.1:${address.port}${path}`;
}

type GatewayRequest = {
	method: string;
	url: string;
	headers: IncomingMessage['headers'];
};
