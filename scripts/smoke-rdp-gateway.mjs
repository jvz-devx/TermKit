import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';

const defaultTimeoutMs = 10_000;
const results = [];
let viteServer;

class SkipSmoke extends Error {
	constructor(message) {
		super(message);
		this.name = 'SkipSmoke';
	}
}

try {
	const gateway = await loadGatewayModule();

	await runSmoke('rdp gateway bootstrapper with mocked Devolutions Gateway', () =>
		smokeMockedGatewayBootstrap(gateway)
	);
	await runSmoke('real Devolutions Gateway RDP bootstrap', () =>
		smokeRealGatewayBootstrap(gateway)
	);

	for (const result of results) printResult(console.log, result);
} catch (error) {
	for (const result of results) printResult(console.error, result);
	console.error(error instanceof Error ? error.stack || error.message : error);
	process.exitCode = 1;
} finally {
	await viteServer?.close();
}

process.exit(process.exitCode ?? 0);

async function loadGatewayModule() {
	viteServer = await createViteServer({
		server: { middlewareMode: true },
		appType: 'custom',
		logLevel: 'error',
		optimizeDeps: {
			noDiscovery: true,
			entries: []
		}
	});

	return viteServer.ssrLoadModule('/src/lib/server/rdp/gateway.ts');
}

async function runSmoke(name, callback) {
	try {
		const detail = await withTimeout(callback(), name, readTimeoutMs());
		results.push({ status: '[pass]', name, detail });
	} catch (error) {
		if (error instanceof SkipSmoke) {
			results.push({ status: '[skip]', name, detail: error.message });
			return;
		}

		results.push({ status: '[fail]', name, detail: errorMessage(error) });
		throw error;
	}
}

async function smokeMockedGatewayBootstrap({ RdpGatewayBootstrapper, loadRdpGatewayConfig }) {
	const provisionerSubject = 'termix-smoke';
	const provisionerKey = 'mock-provisioner-key';
	const appToken = 'mock-app-token';
	const associationToken = 'mock-association-token';
	const gateway = await startMockGateway({
		provisionerSubject,
		provisionerKey,
		appToken,
		associationToken
	});

	try {
		const config = loadRdpGatewayConfig({
			GATEWAY_URL: gateway.url,
			GATEWAY_PUBLIC_URL: `${gateway.url}/gateway`,
			GATEWAY_PROVISIONER_SUBJECT: provisionerSubject,
			GATEWAY_PROVISIONER_KEY: provisionerKey,
			GATEWAY_RDP_SESSION_TTL_SECONDS: '120',
			GATEWAY_RDP_WIDTH: '1600',
			GATEWAY_RDP_HEIGHT: '1000'
		});
		const bootstrapper = new RdpGatewayBootstrapper(config, timeoutFetch(readTimeoutMs()));
		const bootstrap = await bootstrapper.bootstrap({
			ticketId: 'smoke-ticket',
			userId: 'smoke-user',
			hostId: 'smoke-host',
			protocol: 'rdp',
			target: {
				host: 'windows.example.test',
				port: 3389,
				username: 'rdp-user',
				credential: {
					kind: 'password',
					username: 'rdp-user',
					password: 'super-secret-password'
				}
			},
			metadata: {
				domain: 'SMOKE'
			}
		});

		assert(bootstrap.provider === 'devolutions-gateway', 'unexpected bootstrap provider');
		assert(bootstrap.protocol === 'rdp', 'unexpected bootstrap protocol');
		assert(bootstrap.destination === 'tcp://windows.example.test:3389', 'unexpected target');
		assert(bootstrap.gatewayUrl === gateway.url, 'unexpected internal Gateway URL');
		assert(
			bootstrap.gatewayPublicUrl === `${gateway.url}/gateway`,
			'unexpected public Gateway URL'
		);
		assert(bootstrap.associationToken === associationToken, 'association token mismatch');
		assert(bootstrap.preconnectionBlob === associationToken, 'preconnection blob mismatch');
		assert(bootstrap.desktop.width === 1600, 'desktop width mismatch');
		assert(bootstrap.desktop.height === 1000, 'desktop height mismatch');
		assert(bootstrap.identity.username === 'rdp-user', 'username identity mismatch');
		assert(bootstrap.identity.domain === 'SMOKE', 'domain identity mismatch');
		assert(
			bootstrap.credentialHint?.serverHeld === true,
			'password credential was not server-held'
		);
		assert(
			!JSON.stringify(bootstrap).includes('super-secret-password'),
			'bootstrap leaked RDP password'
		);
		assert(gateway.requests.length === 2, 'Gateway did not receive exactly two provisioning calls');
		assert(gateway.requests[0]?.path === '/jet/webapp/app-token', 'missing app-token request');
		assert(
			gateway.requests[1]?.path === '/jet/webapp/session-token',
			'missing session-token request'
		);
		assert(
			gateway.requests[1]?.body?.destination === 'tcp://windows.example.test:3389',
			'session-token request used the wrong destination'
		);
		assert(gateway.requests[1]?.body?.lifetime === 120, 'session-token request used the wrong TTL');

		return 'validated app-token and session-token provisioning flow';
	} finally {
		await gateway.close();
	}
}

async function smokeRealGatewayBootstrap({ RdpGatewayBootstrapper, loadRdpGatewayConfig }) {
	const missing = requiredRealEnv().filter((name) => !process.env[name]?.trim());
	if (missing.length > 0) {
		throw new SkipSmoke(`missing ${missing.join(', ')}`);
	}

	const targetPort = readPort(process.env.TERMIXKIT_SMOKE_RDP_PORT ?? '3389');
	const config = loadRdpGatewayConfig(process.env);
	const bootstrapper = new RdpGatewayBootstrapper(config, timeoutFetch(readTimeoutMs()));
	const target = {
		host: process.env.TERMIXKIT_SMOKE_RDP_HOST.trim(),
		port: targetPort
	};
	const username = process.env.TERMIXKIT_SMOKE_RDP_USERNAME?.trim();
	const password = process.env.TERMIXKIT_SMOKE_RDP_PASSWORD;
	const domain = process.env.TERMIXKIT_SMOKE_RDP_DOMAIN?.trim();

	if (username) target.username = username;
	if (password) {
		target.credential = {
			kind: 'password',
			username,
			password
		};
	}

	const bootstrap = await bootstrapper.bootstrap({
		ticketId: 'smoke-real-ticket',
		userId: process.env.TERMIXKIT_SMOKE_RDP_USER_ID?.trim() || 'termix-rdp-smoke',
		hostId: process.env.TERMIXKIT_SMOKE_RDP_HOST_ID?.trim() || 'termix-rdp-smoke-host',
		protocol: 'rdp',
		target,
		metadata: domain ? { domain } : undefined
	});

	const destination = toTcpTarget(target.host, target.port);
	assert(bootstrap.destination === destination, 'real bootstrap used the wrong destination');
	assert(bootstrap.provider === 'devolutions-gateway', 'unexpected real bootstrap provider');
	assert(bootstrap.protocol === 'rdp', 'unexpected real bootstrap protocol');
	assert(
		bootstrap.associationToken?.length > 0,
		'real bootstrap returned an empty association token'
	);
	assert(
		bootstrap.preconnectionBlob === bootstrap.associationToken,
		'real bootstrap preconnection blob did not match the association token'
	);
	assert(
		!password || !JSON.stringify(bootstrap).includes(password),
		'real bootstrap leaked RDP password'
	);

	return `provisioned ${destination}`;
}

async function startMockGateway({
	provisionerSubject,
	provisionerKey,
	appToken,
	associationToken
}) {
	const requests = [];
	const server = createHttpServer(async (request, response) => {
		try {
			const body = await readJsonBody(request);
			const path = new URL(request.url, 'http://127.0.0.1').pathname;
			requests.push({
				method: request.method,
				path,
				authorization: request.headers.authorization,
				body
			});

			if (request.method !== 'POST') {
				writeText(response, 405, 'Method Not Allowed', 'method not allowed');
				return;
			}

			if (path === '/jet/webapp/app-token') {
				assert(
					request.headers.authorization ===
						`Basic ${Buffer.from(`${provisionerSubject}:${provisionerKey}`).toString('base64')}`,
					'app-token request used the wrong Authorization header'
				);
				assert(body.content_type === 'WEBAPP', 'app-token request used the wrong content type');
				assert(body.subject === 'smoke-user', 'app-token request used the wrong subject');
				writeText(response, 200, 'OK', appToken);
				return;
			}

			if (path === '/jet/webapp/session-token') {
				assert(
					request.headers.authorization === `Bearer ${appToken}`,
					'session-token request used the wrong Authorization header'
				);
				assert(
					body.content_type === 'ASSOCIATION',
					'session-token request used the wrong content type'
				);
				assert(body.protocol === 'rdp', 'session-token request used the wrong protocol');
				assert(typeof body.session_id === 'string' && body.session_id, 'missing session id');
				writeText(response, 200, 'OK', associationToken);
				return;
			}

			writeText(response, 404, 'Not Found', 'not found');
		} catch (error) {
			writeText(response, 500, 'Internal Server Error', errorMessage(error));
		}
	});

	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert(address && typeof address !== 'string', 'mock Gateway did not bind a TCP port');

	return {
		url: `http://127.0.0.1:${address.port}`,
		requests,
		close: () =>
			new Promise((resolveClose, rejectClose) => {
				server.close((error) => (error ? rejectClose(error) : resolveClose()));
			})
	};
}

function requiredRealEnv() {
	return [
		'GATEWAY_URL',
		'GATEWAY_PUBLIC_URL',
		'GATEWAY_PROVISIONER_KEY',
		'TERMIXKIT_SMOKE_RDP_HOST'
	];
}

function timeoutFetch(timeoutMs) {
	return async (input, init = {}) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(input, {
				...init,
				signal: controller.signal
			});
		} finally {
			clearTimeout(timer);
		}
	};
}

async function withTimeout(promise, name, timeoutMs) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)),
					timeoutMs
				);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

function readTimeoutMs() {
	const value = process.env.TERMIXKIT_SMOKE_RDP_GATEWAY_TIMEOUT_MS;
	if (!value) return defaultTimeoutMs;

	const timeoutMs = Number(value);
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
		throw new Error(
			'TERMIXKIT_SMOKE_RDP_GATEWAY_TIMEOUT_MS must be an integer from 1000 to 120000'
		);
	}

	return timeoutMs;
}

function readPort(value) {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error('TERMIXKIT_SMOKE_RDP_PORT must be an integer from 1 to 65535');
	}

	return port;
}

async function readJsonBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	const raw = Buffer.concat(chunks).toString('utf8');
	return raw ? JSON.parse(raw) : {};
}

function writeText(response, statusCode, statusMessage, body) {
	response.writeHead(statusCode, statusMessage, {
		'Content-Type': 'text/plain; charset=utf-8'
	});
	response.end(body);
}

function printResult(write, result) {
	const suffix = result.detail ? ` - ${result.detail}` : '';
	write(`${result.status} ${result.name}${suffix}`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function toTcpTarget(host, port) {
	const bracketedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	return `tcp://${bracketedHost}:${port}`;
}
