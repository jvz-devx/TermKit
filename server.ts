import {
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type RequestListener,
	type ServerResponse
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { env } from 'node:process';
import { createSessionTicketConsumer } from './src/lib/server/ws/ticket-consumer.js';
import { installWebSocketUpgrades } from './src/lib/server/ws/upgrade.js';

const host = env.HOST ?? '0.0.0.0';
const port = Number(env.PORT ?? 3000);
const handlerModulePath = './handler.js';
const { handler } = (await import(/* @vite-ignore */ handlerModulePath)) as {
	handler: RequestListener;
};

const requestBodyLimit = parseBodySizeLimit(env.BODY_SIZE_LIMIT ?? '512K');
const server = createServer((request, response) => {
	const contentLength = request.headers['content-length'];
	if (requestBodyLimit !== Infinity && isContentLengthOverLimit(contentLength, requestBodyLimit)) {
		rejectOversizedRequestBody(request, response, requestBodyLimit);
		return;
	}

	installStreamingBodyLimit(request, response, requestBodyLimit);
	if (isGatewayProxyRequest(request)) {
		proxyGatewayHttpRequest(request, response);
		return;
	}

	handler(request, response);
});

installWebSocketUpgrades(server, {
	tickets: createSessionTicketConsumer(),
	ignoredPaths: [/^\/gateway\/jet(?:\/|$)/],
	requireOrigin: env.NODE_ENV === 'production'
});

server.on('upgrade', (request, socket, head) => {
	if (!isGatewayProxyRequest(request)) return;
	proxyGatewayUpgradeRequest(request, socket, head);
});

server.listen(port, host, () => {
	const address = server.address() as AddressInfo;
	console.log(`TermixKit listening on http://${host}:${address.port}`);
});

function isGatewayProxyRequest(request: IncomingMessage): boolean {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
	if (pathname !== '/gateway/jet' && !pathname.startsWith('/gateway/jet/')) return false;
	return ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(request.method ?? 'GET');
}

function proxyGatewayHttpRequest(request: IncomingMessage, response: ServerResponse): void {
	let target: URL;
	try {
		target = gatewayTargetUrl(request.url);
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

function proxyGatewayUpgradeRequest(
	request: IncomingMessage,
	socket: import('node:net').Socket,
	head: Buffer
): void {
	let target: URL;
	try {
		target = gatewayTargetUrl(request.url);
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

function gatewayTargetUrl(requestUrl: string | undefined): URL {
	const gatewayUrl = env.GATEWAY_URL?.trim();
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
	return {
		...request.headers,
		host: target.host,
		'x-forwarded-host': request.headers.host,
		'x-forwarded-proto':
			(Array.isArray(request.headers['x-forwarded-proto'])
				? request.headers['x-forwarded-proto'][0]
				: request.headers['x-forwarded-proto']) ?? 'http'
	};
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
