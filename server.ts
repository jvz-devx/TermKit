import {
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type RequestListener,
	type Server,
	type ServerResponse
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { env } from 'node:process';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { getSessionFromToken, sessionCookieName } from './src/lib/server/auth.js';
import {
	createSessionTicketConsumer,
	createSshAttachTicketConsumer
} from './src/lib/server/ws/ticket-consumer.js';
import { installWebSocketUpgrades } from './src/lib/server/ws/upgrade.js';
import { liveSshManager } from './src/lib/server/ssh-live/manager.js';
import { sshLiveSessionService } from './src/lib/server/services/ssh-live-sessions.js';

const handlerModulePath = './handler.js';
const gatewayProxyMountPath = '/gateway/jet';
const gatewayRdpProxyPath = '/gateway/jet/rdp';
const gatewayAllowedMethod = 'GET';

export type GatewayProxyAuthenticatedSession = {
	sessionId: string;
	userId: string;
};

export type GatewayProxySessionAuthenticator = (
	request: Pick<IncomingMessage, 'headers'>
) => Promise<GatewayProxyAuthenticatedSession | null>;

export type TermixServerOptions = {
	handler: RequestListener;
	env?: NodeJS.ProcessEnv;
	gatewaySessionAuthenticator?: GatewayProxySessionAuthenticator;
};

type GatewayProxyContext = {
	env: NodeJS.ProcessEnv;
	originPolicy: OriginPolicy;
	authenticateSession: GatewayProxySessionAuthenticator;
};

type GatewayProxyRouteResult =
	| { allowed: true }
	| { allowed: false; status: number; message: string; headers?: Record<string, string> };

export function createTermixServer({
	handler,
	env: serverEnv = env,
	gatewaySessionAuthenticator = authenticateGatewayProxySession
}: TermixServerOptions): Server {
	const requestBodyLimit = parseBodySizeLimit(serverEnv.BODY_SIZE_LIMIT ?? '512K');
	const gatewayContext: GatewayProxyContext = {
		env: serverEnv,
		originPolicy: createOriginPolicy({
			allowedOrigins: configuredAllowedOrigins(serverEnv),
			requireOrigin: serverEnv.NODE_ENV === 'production'
		}),
		authenticateSession: gatewaySessionAuthenticator
	};

	const server = createServer((request, response) => {
		const contentLength = request.headers['content-length'];
		if (
			requestBodyLimit !== Infinity &&
			isContentLengthOverLimit(contentLength, requestBodyLimit)
		) {
			rejectOversizedRequestBody(request, response, requestBodyLimit);
			return;
		}

		installStreamingBodyLimit(request, response, requestBodyLimit);
		if (isGatewayProxyPath(request)) {
			void proxyGatewayHttpRequest(request, response, gatewayContext);
			return;
		}

		handler(request, response);
	});

	installWebSocketUpgrades(server, {
		tickets: createSessionTicketConsumer(),
		sshAttachTickets: createSshAttachTicketConsumer(),
		liveSshManager,
		ignoredPaths: [/^\/gateway\/jet(?:\/|$)/],
		requireOrigin: serverEnv.NODE_ENV === 'production'
	});
	installLiveSshMaintenance(server, serverEnv);

	server.on('upgrade', (request, socket, head) => {
		if (!isGatewayProxyPath(request)) return;
		void proxyGatewayUpgradeRequest(request, socket, head, gatewayContext);
	});

	return server;
}

function installLiveSshMaintenance(server: Server, serverEnv: NodeJS.ProcessEnv): void {
	if (serverEnv.VITEST || serverEnv.TERMIXKIT_LIVE_SSH_MAINTENANCE === '0') return;

	void sshLiveSessionService.markStaleOnStartup().catch(logLiveSshMaintenanceError);

	const intervalMs = Math.max(5_000, Number(serverEnv.TERMIXKIT_LIVE_SSH_IDLE_SWEEP_MS ?? 60_000));
	const interval = setInterval(() => {
		void sshLiveSessionService
			.expireIdleDetachedSessions()
			.then((expiredSessions) => {
				for (const session of expiredSessions) liveSshManager.close(session.id);
			})
			.catch(logLiveSshMaintenanceError);
	}, intervalMs);
	interval.unref();
	server.once('close', () => clearInterval(interval));
}

function logLiveSshMaintenanceError(error: unknown): void {
	console.warn('Live SSH maintenance failed', {
		error: error instanceof Error ? { name: error.name, message: error.message } : error
	});
}

export async function startTermixServer(serverEnv: NodeJS.ProcessEnv = env): Promise<Server> {
	const { handler } = (await import(/* @vite-ignore */ handlerModulePath)) as {
		handler: RequestListener;
	};
	const host = serverEnv.HOST ?? '0.0.0.0';
	const port = Number(serverEnv.PORT ?? 3000);
	const server = createTermixServer({ handler, env: serverEnv });

	server.listen(port, host, () => {
		const address = server.address() as AddressInfo;
		console.log(`TermixKit listening on http://${host}:${address.port}`);
	});

	return server;
}

if (isMainModule(import.meta.url) && !env.VITEST) {
	await startTermixServer();
}

function isGatewayProxyPath(request: Pick<IncomingMessage, 'url'>): boolean {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
	return pathname === gatewayProxyMountPath || pathname.startsWith(`${gatewayProxyMountPath}/`);
}

async function proxyGatewayHttpRequest(
	request: IncomingMessage,
	response: ServerResponse,
	context: GatewayProxyContext
): Promise<void> {
	const route = parseGatewayProxyRoute(request);
	if (!route.allowed) {
		writeJsonResponse(response, route.status, route.message, route.headers);
		return;
	}

	if (!isAllowedGatewayOrigin(request, context.originPolicy)) {
		writeJsonResponse(response, 403, 'Gateway origin is not allowed');
		return;
	}

	const authenticatedSession = await authenticateGatewayRequest(request, context);
	if (!authenticatedSession) {
		writeJsonResponse(response, 401, 'Authentication required');
		return;
	}

	let target: URL;
	try {
		target = gatewayTargetUrl(request.url, context.env);
	} catch (error) {
		response.writeHead(502, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ error: errorMessage(error) }));
		return;
	}

	const proxy = gatewayRequest(
		target,
		{
			method: request.method,
			headers: gatewayProxyHeaders(request, target)
		},
		(gatewayResponse) => {
			response.writeHead(gatewayResponse.statusCode ?? 502, gatewayResponse.headers);
			gatewayResponse.pipe(response);
		}
	);

	proxy.on('error', (error) => {
		if (response.headersSent || response.writableEnded) {
			request.destroy(error);
			return;
		}

		response.writeHead(502, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ error: `Gateway proxy failed: ${error.message}` }));
	});

	request.pipe(proxy);
}

async function proxyGatewayUpgradeRequest(
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer,
	context: GatewayProxyContext
): Promise<void> {
	const route = parseGatewayProxyRoute(request);
	if (!route.allowed) {
		rejectGatewayUpgrade(socket, route.status, route.message);
		return;
	}

	if (!isAllowedGatewayOrigin(request, context.originPolicy)) {
		rejectGatewayUpgrade(socket, 403, 'Gateway origin is not allowed');
		return;
	}

	const authenticatedSession = await authenticateGatewayRequest(request, context);
	if (!authenticatedSession) {
		rejectGatewayUpgrade(socket, 401, 'Authentication required');
		return;
	}

	let target: URL;
	try {
		target = gatewayTargetUrl(request.url, context.env);
	} catch (error) {
		socket.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n${errorMessage(error)}`);
		return;
	}

	const proxy = gatewayRequest(target, {
		method: request.method,
		headers: gatewayProxyHeaders(request, target)
	});

	proxy.on('upgrade', (gatewayResponse, gatewaySocket, gatewayHead) => {
		socket.write(
			[
				`HTTP/1.1 ${gatewayResponse.statusCode ?? 101} ${gatewayResponse.statusMessage ?? 'Switching Protocols'}`,
				...Object.entries(gatewayResponse.headers)
					.filter(([, value]) => value !== undefined)
					.flatMap(([key, value]) =>
						Array.isArray(value) ? value.map((entry) => `${key}: ${entry}`) : [`${key}: ${value}`]
					),
				'\r\n'
			].join('\r\n')
		);
		if (gatewayHead.length > 0) socket.write(gatewayHead);
		if (head.length > 0) gatewaySocket.write(head);
		gatewaySocket.pipe(socket);
		socket.pipe(gatewaySocket);
	});

	proxy.on('response', (gatewayResponse) => {
		socket.write(
			[
				`HTTP/1.1 ${gatewayResponse.statusCode ?? 502} ${gatewayResponse.statusMessage ?? 'Bad Gateway'}`,
				'Connection: close',
				'\r\n'
			].join('\r\n')
		);
		gatewayResponse.resume();
		socket.end();
	});

	proxy.on('error', (error) => {
		socket.end(
			`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\nGateway proxy failed: ${error.message}`
		);
	});

	proxy.end();
}

function parseGatewayProxyRoute(
	request: Pick<IncomingMessage, 'method' | 'url'>
): GatewayProxyRouteResult {
	const url = new URL(request.url ?? '/', 'http://localhost');
	const method = request.method ?? 'GET';

	if (url.pathname !== gatewayRdpProxyPath) {
		return {
			allowed: false,
			status: 404,
			message: 'Gateway route is not available'
		};
	}

	if (method !== gatewayAllowedMethod) {
		return {
			allowed: false,
			status: 405,
			message: 'Gateway method is not allowed',
			headers: { allow: gatewayAllowedMethod }
		};
	}

	return { allowed: true };
}

async function authenticateGatewayRequest(
	request: IncomingMessage,
	context: GatewayProxyContext
): Promise<GatewayProxyAuthenticatedSession | null> {
	const session = await context.authenticateSession(request).catch((error: unknown) => {
		console.warn('Gateway proxy session authentication failed', {
			error: diagnosticError(error)
		});
		return null;
	});

	return isValidGatewayProxySession(session) ? session : null;
}

async function authenticateGatewayProxySession(
	request: Pick<IncomingMessage, 'headers'>
): Promise<GatewayProxyAuthenticatedSession | null> {
	const token = sessionTokenFromCookieHeader(request.headers.cookie);
	if (!token) return null;

	const authenticated = await getSessionFromToken(token);
	if (!authenticated) return null;

	return {
		sessionId: authenticated.session.id,
		userId: authenticated.user.id
	};
}

function isValidGatewayProxySession(
	session: GatewayProxyAuthenticatedSession | null
): session is GatewayProxyAuthenticatedSession {
	return session !== null && session.sessionId.length > 0 && session.userId.length > 0;
}

function gatewayTargetUrl(requestUrl: string | undefined, serverEnv: NodeJS.ProcessEnv): URL {
	const gatewayUrl = serverEnv.GATEWAY_URL?.trim();
	if (!gatewayUrl) throw new Error('GATEWAY_URL is required for Gateway proxying');

	const source = new URL(requestUrl ?? '/', 'http://localhost');
	const targetPath = source.pathname.replace(/^\/gateway(?=\/|$)/, '') || '/';
	const target = new URL(targetPath + source.search, ensureTrailingSlash(gatewayUrl));
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		throw new Error('GATEWAY_URL must use http:// or https:// for Gateway proxying');
	}

	return target;
}

function gatewayRequest(
	target: URL,
	options: Parameters<typeof httpRequest>[1],
	callback?: Parameters<typeof httpRequest>[2]
): ReturnType<typeof httpRequest> {
	return target.protocol === 'https:'
		? httpsRequest(target, options, callback)
		: httpRequest(target, options, callback);
}

function gatewayProxyHeaders(request: IncomingMessage, target: URL): IncomingMessage['headers'] {
	const headers = { ...request.headers };
	delete headers.cookie;

	return {
		...headers,
		host: target.host,
		'x-forwarded-host': request.headers.host,
		'x-forwarded-proto':
			(Array.isArray(request.headers['x-forwarded-proto'])
				? request.headers['x-forwarded-proto'][0]
				: request.headers['x-forwarded-proto']) ?? 'http'
	};
}

type OriginPolicy = {
	allowedOrigins: Set<string>;
	requireOrigin: boolean;
};

function createOriginPolicy({
	allowedOrigins,
	requireOrigin
}: {
	allowedOrigins?: string[];
	requireOrigin: boolean;
}): OriginPolicy {
	const configuredOrigins = allowedOrigins ?? configuredAllowedOrigins(env);

	return {
		allowedOrigins: new Set(configuredOrigins.map(normalizeOrigin).filter(isString)),
		requireOrigin
	};
}

function configuredAllowedOrigins(serverEnv: NodeJS.ProcessEnv): string[] {
	return serverEnv.ORIGIN ? [serverEnv.ORIGIN] : [];
}

function isAllowedGatewayOrigin(
	request: Pick<IncomingMessage, 'headers' | 'socket'>,
	policy: OriginPolicy
): boolean {
	const originHeader = request.headers.origin;
	const origin = Array.isArray(originHeader) ? null : normalizeOrigin(originHeader);

	if (!origin) {
		return !policy.requireOrigin;
	}

	if (policy.allowedOrigins.size > 0) {
		return policy.allowedOrigins.has(origin);
	}

	return origin === requestOrigin(request);
}

function requestOrigin(request: Pick<IncomingMessage, 'headers' | 'socket'>): string | null {
	const host = request.headers.host;
	if (!host || Array.isArray(host)) return null;

	const forwardedProto = request.headers['x-forwarded-proto'];
	const protocol =
		(Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
			?.split(',')[0]
			?.trim()
			?.toLowerCase() ?? ((request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');

	return normalizeOrigin(`${protocol}://${host}`);
}

function normalizeOrigin(value: string | undefined): string | null {
	if (!value) return null;

	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.origin;
	} catch {
		return null;
	}
}

function sessionTokenFromCookieHeader(header: string | string[] | undefined): string | null {
	const headers = Array.isArray(header) ? header : header ? [header] : [];

	for (const entry of headers) {
		for (const cookie of entry.split(';')) {
			const [rawName, ...rawValue] = cookie.trim().split('=');
			if (rawName !== sessionCookieName || rawValue.length === 0) continue;

			const value = rawValue.join('=');
			try {
				return decodeURIComponent(value);
			} catch {
				return value;
			}
		}
	}

	return null;
}

function writeJsonResponse(
	response: ServerResponse,
	status: number,
	message: string,
	headers: Record<string, string> = {}
): void {
	response.writeHead(status, {
		...headers,
		'content-type': 'application/json'
	});
	response.end(JSON.stringify({ error: message }));
}

function rejectGatewayUpgrade(socket: Duplex, status: number, message: string): void {
	socket.write(
		`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(
			message
		)}\r\n\r\n${message}`
	);
	socket.destroy();
}

function diagnosticError(error: unknown): { name: string; message: string } {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: 'Gateway proxy authentication failed before proxying'
		};
	}

	return {
		name: 'UnknownError',
		message: 'Gateway proxy authentication failed'
	};
}

function isString(value: string | null): value is string {
	return typeof value === 'string';
}

function isMainModule(moduleUrl: string): boolean {
	return process.argv[1] ? fileURLToPath(moduleUrl) === process.argv[1] : false;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function ensureTrailingSlash(value: string): string {
	return value.endsWith('/') ? value : `${value}/`;
}

function isContentLengthOverLimit(
	value: string | string[] | undefined,
	limitBytes: number
): boolean {
	const contentLength = Array.isArray(value) ? value[0] : value;
	if (!contentLength || !/^\d+$/.test(contentLength)) return false;
	return BigInt(contentLength) > BigInt(limitBytes);
}

function installStreamingBodyLimit(
	request: IncomingMessage,
	response: ServerResponse,
	limitBytes: number
): void {
	if (limitBytes === Infinity || request.method === 'GET' || request.method === 'HEAD') return;

	let receivedBytes = 0;
	let rejected = false;
	const originalEmit = request.emit;
	const callOriginalEmit = originalEmit as (
		this: IncomingMessage,
		eventName: string | symbol,
		...args: unknown[]
	) => boolean;

	request.emit = function limitedEmit(
		this: IncomingMessage,
		eventName: string | symbol,
		...args: unknown[]
	): boolean {
		if (eventName === 'data' && !rejected) {
			receivedBytes += getChunkByteLength(args[0]);
			if (receivedBytes > limitBytes) {
				rejected = true;
				request.pause();
				rejectOversizedRequestBody(request, response, limitBytes);
				return false;
			}
		}

		return callOriginalEmit.call(this, eventName, ...args);
	} as IncomingMessage['emit'];

	request.once('close', () => {
		request.emit = originalEmit;
	});
}

function getChunkByteLength(chunk: unknown): number {
	if (typeof chunk === 'string') return Buffer.byteLength(chunk);
	if (chunk instanceof ArrayBuffer) return chunk.byteLength;
	if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
	return 0;
}

function rejectOversizedRequestBody(
	request: IncomingMessage,
	response: ServerResponse,
	limitBytes: number
): void {
	const message = `Request body exceeds the configured ${formatByteLimit(limitBytes)} limit`;
	if (response.headersSent || response.writableEnded) {
		request.destroy();
		return;
	}

	response.writeHead(413, {
		connection: 'close',
		'content-type': 'application/json'
	});
	response.end(JSON.stringify({ error: message, issues: [message] }), () => {
		request.destroy();
	});
}

function parseBodySizeLimit(value: string): number {
	const normalized = value.trim();
	if (normalized === '0' || normalized.toLowerCase() === 'infinity') return Infinity;

	const match = /^(\d+)([kmg])?$/i.exec(normalized);
	if (!match) throw new Error(`BODY_SIZE_LIMIT must be bytes or use K, M, or G units: ${value}`);

	const bytes = Number(match[1]) * bodySizeUnitMultiplier(match[2]);
	if (!Number.isSafeInteger(bytes)) {
		throw new Error(`BODY_SIZE_LIMIT is too large: ${value}`);
	}
	return bytes;
}

function bodySizeUnitMultiplier(unit: string | undefined): number {
	switch (unit?.toLowerCase()) {
		case 'k':
			return 1024;
		case 'm':
			return 1024 * 1024;
		case 'g':
			return 1024 * 1024 * 1024;
		default:
			return 1;
	}
}

function formatByteLimit(bytes: number): string {
	const mib = bytes / 1024 / 1024;
	if (Number.isInteger(mib)) return `${mib} MiB`;
	const kib = bytes / 1024;
	if (Number.isInteger(kib)) return `${kib} KiB`;
	return `${bytes} bytes`;
}
