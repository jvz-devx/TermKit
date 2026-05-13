import { createServer, type RequestListener } from 'node:http';
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
		const message = `Request body exceeds the configured ${formatByteLimit(requestBodyLimit)} limit`;
		response.writeHead(413, {
			connection: 'close',
			'content-type': 'application/json'
		});
		response.end(JSON.stringify({ error: message, issues: [message] }));
		request.destroy();
		return;
	}

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
