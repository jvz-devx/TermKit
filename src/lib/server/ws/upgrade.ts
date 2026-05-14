import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { getSessionFromToken, sessionCookieName } from '$lib/server/auth';
import type { SshAttachTicket } from '$lib/server/ssh-live/types';
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
import {
	sshLiveSessionService,
	type SshLiveSessionService
} from '$lib/server/services/ssh-live-sessions';

export type WebSocketUpgradeOptions = {
	tickets?: TicketConsumer;
	sshAttachTickets?: SshAttachTicketConsumer;
	liveSshManager?: LiveSshManager;
	adapters?: ProtocolAdapter[];
	connectionSessions?: ConnectionSessionLifecycleRecorder;
	liveSshSessions?: Pick<SshLiveSessionService, 'markAttached' | 'markDetached' | 'end' | 'fail'>;
	allowedOrigins?: string[];
	ignoredPaths?: RegExp[];
	requireOrigin?: boolean;
	authenticateSession?: WebSocketSessionAuthenticator;
};

export type AuthenticatedWebSocketSession = {
	sessionId: string;
	userId: string;
};

export type WebSocketSessionAuthenticator = (
	request: Pick<IncomingMessage, 'headers'>
) => Promise<AuthenticatedWebSocketSession | null>;

export type SshAttachTicketConsumer = {
	consume(ticket: string, userId: string): Promise<SshAttachTicket | null>;
};

export type LiveSshManager = {
	handle(socket: WebSocket, attachTicket: SshAttachTicket): unknown | Promise<unknown>;
	hasActiveAttachment?(sessionId: string): boolean;
};

export type { SshAttachTicket } from '$lib/server/ssh-live/types';

const WS_PATH = /^\/ws\/(ssh|vnc|telnet|rdp)\/([^/]+)$/;
const SSH_LIVE_PATH = /^\/ws\/ssh\/live\/([^/]+)$/;

const rejectingSshAttachTicketConsumer: SshAttachTicketConsumer = {
	async consume() {
		return null;
	}
};

export function installWebSocketUpgrades(
	server: HttpServer,
	{
		tickets = rejectingTicketConsumer,
		sshAttachTickets = rejectingSshAttachTicketConsumer,
		liveSshManager,
		adapters = defaultProtocolAdapters(),
		connectionSessions = connectionSessionService,
		liveSshSessions = sshLiveSessionService,
		allowedOrigins,
		ignoredPaths = [],
		requireOrigin = false,
		authenticateSession = authenticateWebSocketSession
	}: WebSocketUpgradeOptions = {}
): void {
	const webSockets = new WebSocketServer({ noServer: true });
	const adapterByProtocol = new Map(adapters.map((adapter) => [adapter.protocol, adapter]));
	const originPolicy = createOriginPolicy({ allowedOrigins, requireOrigin });

	server.on('upgrade', async (request, socket, head) => {
		if (isIgnoredUpgradePath(request.url, ignoredPaths)) return;

		const route = parseWebSocketRoute(request);

		if (!route) {
			rejectUpgrade(socket, 404, 'Unknown websocket route');
			return;
		}

		if (!isAllowedWebSocketOrigin(request, originPolicy)) {
			rejectUpgrade(socket, 403, 'WebSocket origin is not allowed');
			return;
		}

		const authenticatedSession = await authenticateSession(request).catch((error: unknown) => {
			logSessionUpgradeFailure(error);
			return null;
		});

		if (!isValidAuthenticatedSession(authenticatedSession)) {
			rejectUpgrade(socket, 401, 'Authentication required');
			return;
		}

		if (route.live) {
			if (!liveSshManager) {
				rejectUpgrade(socket, 501, 'Live SSH manager unavailable');
				return;
			}

			const attachTicket = await sshAttachTickets
				.consume(route.ticket, authenticatedSession.userId)
				.catch((error: unknown) => {
					logSshAttachTicketUpgradeFailure(error);
					return null;
				});

			if (
				!isValidSshAttachTicket(attachTicket) ||
				attachTicket.userId !== authenticatedSession.userId
			) {
				rejectUpgrade(socket, 401, 'Invalid or expired SSH attach ticket');
				return;
			}

			webSockets.handleUpgrade(request, socket, head, (webSocket) => {
				webSockets.emit('connection', webSocket, request);
				void handleLiveSshConnection(webSocket, liveSshManager, attachTicket, liveSshSessions);
			});
			return;
		}

		const adapter = adapterByProtocol.get(route.protocol);
		if (!adapter) {
			rejectUpgrade(socket, 501, 'Protocol adapter unavailable');
			return;
		}

		const consumedTicket = await tickets
			.consume(route.ticket, route.protocol, authenticatedSession.userId)
			.catch((error: unknown) => {
				logTicketUpgradeFailure(route.protocol, error);
				return null;
			});

		if (
			!isValidConsumedTicketContext(consumedTicket, route.protocol) ||
			consumedTicket.userId !== authenticatedSession.userId
		) {
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

function isIgnoredUpgradePath(url: string | undefined, ignoredPaths: RegExp[]): boolean {
	if (ignoredPaths.length === 0) return false;
	const pathname = new URL(url ?? '/', 'http://localhost').pathname;
	return ignoredPaths.some((pattern) => pattern.test(pathname));
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
):
	| { protocol: Protocol; ticket: string; live?: false }
	| { protocol: 'ssh'; ticket: string; live: true }
	| null {
	const url = new URL(request.url ?? '/', 'http://localhost');
	const liveMatch = SSH_LIVE_PATH.exec(url.pathname);

	if (liveMatch) {
		return {
			protocol: 'ssh',
			ticket: decodeURIComponent(liveMatch[1]),
			live: true
		};
	}

	const match = WS_PATH.exec(url.pathname);

	if (!match) {
		return null;
	}

	return {
		protocol: match[1] as Protocol,
		ticket: decodeURIComponent(match[2])
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
	const configuredOrigins = allowedOrigins ?? configuredAllowedOrigins();

	return {
		allowedOrigins: new Set(configuredOrigins.map(normalizeOrigin).filter(isString)),
		requireOrigin
	};
}

function configuredAllowedOrigins(): string[] {
	return process.env.ORIGIN ? [process.env.ORIGIN] : [];
}

function isAllowedWebSocketOrigin(
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

async function authenticateWebSocketSession(
	request: Pick<IncomingMessage, 'headers'>
): Promise<AuthenticatedWebSocketSession | null> {
	const token = sessionTokenFromCookieHeader(request.headers.cookie);
	if (!token) return null;

	const authenticated = await getSessionFromToken(token);
	if (!authenticated) return null;

	return {
		sessionId: authenticated.session.id,
		userId: authenticated.user.id
	};
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

function isValidAuthenticatedSession(
	session: AuthenticatedWebSocketSession | null
): session is AuthenticatedWebSocketSession {
	return session !== null && session.sessionId.length > 0 && session.userId.length > 0;
}

function isValidConsumedTicketContext(
	ticket: ConsumedTicket | null,
	expectedProtocol: Protocol
): ticket is ConsumedTicket {
	return (
		ticket !== null &&
		ticket.protocol === expectedProtocol &&
		ticket.ticketId.length > 0 &&
		ticket.userId.length > 0 &&
		ticket.hostId.length > 0 &&
		typeof ticket.target === 'object' &&
		ticket.target !== null &&
		typeof ticket.target.host === 'string' &&
		ticket.target.host.length > 0 &&
		Number.isSafeInteger(ticket.target.port) &&
		ticket.target.port > 0 &&
		ticket.target.port <= 65_535
	);
}

function isValidSshAttachTicket(ticket: SshAttachTicket | null): ticket is SshAttachTicket {
	return (
		ticket !== null &&
		ticket.ticketId.length > 0 &&
		ticket.userId.length > 0 &&
		ticket.sshLiveSessionId.length > 0 &&
		isValidConsumedTicketContext(ticket.session, 'ssh') &&
		ticket.session.userId === ticket.userId &&
		ticket.session.ticketId === ticket.sshLiveSessionId
	);
}

function isString(value: string | null): value is string {
	return typeof value === 'string';
}

function logTicketUpgradeFailure(protocol: Protocol, error: unknown): void {
	console.warn('WebSocket session ticket upgrade failed', {
		protocol,
		error: diagnosticError(error)
	});
}

function logSessionUpgradeFailure(error: unknown): void {
	console.warn('WebSocket session authentication failed', {
		error: diagnosticError(error)
	});
}

function logSshAttachTicketUpgradeFailure(error: unknown): void {
	console.warn('WebSocket SSH attach ticket upgrade failed', {
		error: diagnosticError(error)
	});
}

function diagnosticError(error: unknown): { name: string; message: string } {
	if (error instanceof Error) {
		const isCredentialEncryptionError = error.name === 'CredentialEncryptionError';
		return {
			name: error.name,
			message: isCredentialEncryptionError
				? error.message
				: 'Session ticket upgrade failed before websocket acceptance'
		};
	}

	return {
		name: 'UnknownError',
		message: 'Session ticket upgrade failed'
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

async function handleLiveSshConnection(
	webSocket: WebSocket,
	liveSshManager: LiveSshManager,
	attachTicket: SshAttachTicket,
	liveSshSessions: Pick<SshLiveSessionService, 'markAttached' | 'markDetached' | 'end' | 'fail'>
): Promise<void> {
	let releaseClosePersistence: () => void;
	const attachmentRecorded = new Promise<void>((resolve) => {
		releaseClosePersistence = resolve;
	});

	webSocket.once('close', (code, reason) => {
		const closeReason = reason.toString('utf8');
		void attachmentRecorded.then(() => {
			if (closeReason === 'ssh session reattached') return;
			if (liveSshManager.hasActiveAttachment?.(attachTicket.sshLiveSessionId)) return;

			return persistLiveSshSocketClose(liveSshSessions, attachTicket, code, closeReason);
		});
	});

	try {
		await liveSshManager.handle(webSocket, attachTicket);
		await liveSshSessions
			.markAttached(
				attachTicket.userId,
				attachTicket.sshLiveSessionId,
				{
					terminalCols: attachTicket.terminalCols,
					terminalRows: attachTicket.terminalRows
				},
				attachTicket.consumedAt ?? new Date()
			)
			.catch(() => undefined);
	} catch {
		void liveSshSessions
			.fail(attachTicket.userId, attachTicket.sshLiveSessionId)
			.catch(() => undefined);
		if (webSocket.readyState === webSocket.OPEN) {
			webSocket.close(1011, 'live ssh manager failed');
		}
	} finally {
		releaseClosePersistence!();
	}
}

async function persistLiveSshSocketClose(
	liveSshSessions: Pick<SshLiveSessionService, 'markDetached' | 'end' | 'fail'>,
	attachTicket: SshAttachTicket,
	closeCode: number,
	closeReason: string
): Promise<void> {
	if (closeReason === 'ssh shell closed' || closeReason === 'ssh session closed') {
		await liveSshSessions
			.end(attachTicket.userId, attachTicket.sshLiveSessionId)
			.catch(() => undefined);
		return;
	}

	if (
		isFailedCloseCode(closeCode) ||
		closeReason === 'ssh shell failed' ||
		closeReason === 'ssh connection failed' ||
		closeReason === 'ssh host key not trusted' ||
		closeReason === 'live ssh manager failed'
	) {
		await liveSshSessions
			.fail(attachTicket.userId, attachTicket.sshLiveSessionId)
			.catch(() => undefined);
		return;
	}

	await liveSshSessions
		.markDetached(attachTicket.userId, attachTicket.sshLiveSessionId)
		.catch(() => undefined);
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
