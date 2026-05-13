import {
	createServer,
	type IncomingMessage,
	type RequestListener,
	type ServerResponse
} from 'node:http';
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
	handler(request, response);
});

installWebSocketUpgrades(server, {
	tickets: createSessionTicketConsumer(),
	requireOrigin: env.NODE_ENV === 'production'
});

server.listen(port, host, () => {
	const address = server.address() as AddressInfo;
	console.log(`TermixKit listening on http://${host}:${address.port}`);
});

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
