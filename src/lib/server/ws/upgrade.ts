import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import {
	createRdpGatewayPlaceholderAdapter,
	createSshAdapter,
	createTelnetAdapter,
	createVncAdapter,
	rejectingTicketConsumer,
	type Protocol,
	type ProtocolAdapter,
	type TicketConsumer
} from '$lib/server/protocols';

export type WebSocketUpgradeOptions = {
	tickets?: TicketConsumer;
	adapters?: ProtocolAdapter[];
};

const WS_PATH = /^\/ws\/(ssh|vnc|telnet|rdp)\/([^/]+)$/;

export function installWebSocketUpgrades(
	server: HttpServer,
	{
		tickets = rejectingTicketConsumer,
		adapters = defaultProtocolAdapters()
	}: WebSocketUpgradeOptions = {}
): void {
	const webSockets = new WebSocketServer({ noServer: true });
	const adapterByProtocol = new Map(adapters.map((adapter) => [adapter.protocol, adapter]));

	server.on('upgrade', async (request, socket, head) => {
		const route = parseWebSocketRoute(request);

		if (!route) {
			rejectUpgrade(socket, 404, 'Unknown websocket route');
			return;
		}

		const adapter = adapterByProtocol.get(route.protocol);
		if (!adapter) {
			rejectUpgrade(socket, 501, 'Protocol adapter unavailable');
			return;
		}

		const consumedTicket = await tickets.consume(route.ticket, route.protocol).catch(() => null);

		if (!consumedTicket || consumedTicket.protocol !== route.protocol) {
			rejectUpgrade(socket, 401, 'Invalid or expired session ticket');
			return;
		}

		webSockets.handleUpgrade(request, socket, head, (webSocket) => {
			webSockets.emit('connection', webSocket, request);
			void adapter.handle(webSocket, consumedTicket);
		});
	});
}

export function defaultProtocolAdapters(): ProtocolAdapter[] {
	return [
		createSshAdapter(),
		createVncAdapter(),
		createTelnetAdapter(),
		createRdpGatewayPlaceholderAdapter()
	];
}

export function parseWebSocketRoute(
	request: Pick<IncomingMessage, 'url'>
): { protocol: Protocol; ticket: string } | null {
	const url = new URL(request.url ?? '/', 'http://localhost');
	const match = WS_PATH.exec(url.pathname);

	if (!match) {
		return null;
	}

	return {
		protocol: match[1] as Protocol,
		ticket: decodeURIComponent(match[2])
	};
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
	socket.write(
		`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(
			message
		)}\r\n\r\n${message}`
	);
	socket.destroy();
}
