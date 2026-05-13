import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import {
	createRdpGatewayPlaceholderAdapter,
	createSshAdapter,
	createTelnetAdapter,
	createVncAdapter,
	type ConsumedTicket,
	rejectingTicketConsumer,
	type Protocol,
	type ProtocolAdapter,
	type TicketConsumer
} from '$lib/server/protocols';
import {
	connectionSessionService,
	type ConnectionSessionLifecycleRecorder
} from '$lib/server/services/connection-sessions';

export type WebSocketUpgradeOptions = {
	tickets?: TicketConsumer;
	adapters?: ProtocolAdapter[];
	connectionSessions?: ConnectionSessionLifecycleRecorder;
};

const WS_PATH = /^\/ws\/(ssh|vnc|telnet|rdp)\/([^/]+)$/;

export function installWebSocketUpgrades(
	server: HttpServer,
	{
		tickets = rejectingTicketConsumer,
		adapters = defaultProtocolAdapters(),
		connectionSessions = connectionSessionService
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

		const connectionSession = await connectionSessions
			.start({
				userId: consumedTicket.userId,
				hostId: consumedTicket.hostId,
				protocol: consumedTicket.protocol
			})
			.catch(() => null);

		webSockets.handleUpgrade(request, socket, head, (webSocket) => {
			webSockets.emit('connection', webSocket, request);
			void handleTrackedConnection({
				connectionSessions,
				connectionSessionId: connectionSession?.id ?? null,
				webSocket,
				adapter,
				ticket: consumedTicket
			});
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

type TrackedConnectionInput = {
	connectionSessions: ConnectionSessionLifecycleRecorder;
	connectionSessionId: string | null;
	webSocket: Parameters<ProtocolAdapter['handle']>[0];
	adapter: ProtocolAdapter;
	ticket: ConsumedTicket;
};

async function handleTrackedConnection({
	connectionSessions,
	connectionSessionId,
	webSocket,
	adapter,
	ticket
}: TrackedConnectionInput): Promise<void> {
	let finalized = false;
	let lifecycleQueue: Promise<unknown> = Promise.resolve();

	const enqueueLifecycle = (work: () => Promise<unknown>) => {
		lifecycleQueue = lifecycleQueue.then(work).catch(() => undefined);
		return lifecycleQueue;
	};

	const finalize = (status: 'ended' | 'failed', errorCode?: string) => {
		if (!connectionSessionId || finalized) return;

		finalized = true;
		void enqueueLifecycle(() =>
			status === 'failed'
				? connectionSessions.fail(connectionSessionId, errorCode ?? 'connection_failed')
				: connectionSessions.end(connectionSessionId)
		);
	};

	webSocket.once('error', () => finalize('failed', 'websocket_error'));
	webSocket.once('close', (code) => {
		if (isFailedCloseCode(code)) {
			finalize('failed', `websocket_close_${code}`);
			return;
		}

		finalize('ended');
	});

	if (connectionSessionId) {
		void enqueueLifecycle(() => connectionSessions.markActive(connectionSessionId));
	}

	try {
		await adapter.handle(webSocket, ticket);
	} catch (error) {
		finalize('failed', adapterErrorCode(error));
		if (webSocket.readyState === webSocket.OPEN) {
			webSocket.close(1011, 'protocol adapter failed');
		}
	}
}

function isFailedCloseCode(code: number): boolean {
	return code !== 1000 && code !== 1001;
}

function adapterErrorCode(error: unknown): string {
	if (error instanceof Error && error.name && error.name !== 'Error') {
		return `adapter_${error.name.toLowerCase()}`;
	}

	return 'adapter_error';
}
