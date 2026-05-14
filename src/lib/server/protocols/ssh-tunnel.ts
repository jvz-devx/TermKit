import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { RawData, WebSocket } from 'ws';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import type {
	SshTunnelFailureCode,
	SshTunnelSessionRecord
} from '$lib/server/services/ssh-tunnels';
import { buildTrustedSshConnectConfig, type SshHostKeyTrustError } from './ssh-host-trust';
import { resolveSftpTarget, type SftpTarget } from './sftp';

const maxTunnelRequestBytes = 25 * 1024 * 1024;
const proxyHopByHopHeaders = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]);
const sensitiveBrowserHeaders = new Set(['authorization', 'cookie']);

export type SshTunnelConnectTarget = SftpTarget;

export interface SshTunnelHttpResponse {
	status: number;
	statusText: string;
	headers: Headers;
	body: ArrayBuffer;
}

export class SshTunnelProxyError extends Error {
	constructor(
		readonly code: SshTunnelFailureCode,
		message: string = code
	) {
		super(message);
		this.name = 'SshTunnelProxyError';
	}
}

export async function resolveSshTunnelConnectTarget(
	userId: string,
	hostId: string
): Promise<SshTunnelConnectTarget> {
	return resolveSftpTarget(userId, hostId);
}

export async function proxyHttpTunnelRequest(
	sshTarget: SshTunnelConnectTarget,
	session: Pick<SshTunnelSessionRecord, 'targetHost' | 'targetPort'>,
	request: Request,
	upstreamPath: string
): Promise<SshTunnelHttpResponse> {
	const body = await readRequestBody(request);
	const requestBytes = buildForwardHttpRequest({
		request,
		path: upstreamPath,
		targetHost: session.targetHost,
		targetPort: session.targetPort,
		body
	});
	const connection = await connectSsh(sshTarget);

	try {
		const channel = await openForwardChannel(connection, session.targetHost, session.targetPort);
		const responseBytes = await writeAndRead(channel, requestBytes);
		return parseForwardHttpResponse(responseBytes);
	} finally {
		connection.end();
	}
}

export async function proxyTcpTunnelWebSocket(
	sshTarget: SshTunnelConnectTarget,
	session: Pick<SshTunnelSessionRecord, 'targetHost' | 'targetPort'>,
	socket: WebSocket
): Promise<void> {
	const connection = await connectSsh(sshTarget);
	let channel: ClientChannel | null = null;
	let cleanedUp = false;

	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		socket.off('message', onMessage);
		socket.off('close', onSocketClose);
		socket.off('error', onSocketError);
		channel?.off('data', onChannelData);
		channel?.off('close', onChannelClose);
		channel?.off('error', onChannelError);
		connection.end();
	};
	const closeSocket = (code: number, reason: string) => {
		if (socket.readyState === socket.OPEN) socket.close(code, reason);
	};
	const onMessage = (data: RawData) => {
		if (!channel || channel.destroyed) return;
		channel.write(rawDataToBuffer(data));
	};
	const onSocketClose = () => {
		channel?.end();
		cleanup();
	};
	const onSocketError = () => {
		channel?.destroy();
		cleanup();
	};
	const onChannelData = (chunk: Buffer) => {
		if (socket.readyState === socket.OPEN) socket.send(chunk);
	};
	const onChannelClose = () => {
		closeSocket(1000, 'tunnel target closed');
		cleanup();
	};
	const onChannelError = () => {
		closeSocket(1011, 'tunnel target failed');
		cleanup();
	};

	try {
		channel = await openForwardChannel(connection, session.targetHost, session.targetPort);
	} catch (error) {
		connection.end();
		throw error;
	}

	socket.on('message', onMessage);
	socket.once('close', onSocketClose);
	socket.once('error', onSocketError);
	channel.on('data', onChannelData);
	channel.once('close', onChannelClose);
	channel.once('error', onChannelError);
}

export function buildForwardHttpRequest({
	request,
	path,
	targetHost,
	targetPort,
	body
}: {
	request: Pick<Request, 'method' | 'headers'>;
	path: string;
	targetHost: string;
	targetPort: number;
	body: Uint8Array;
}): Buffer {
	const headers = proxyRequestHeaders(request.headers, targetHost, targetPort, body.byteLength);
	const requestPath = path.startsWith('/') ? path : `/${path}`;
	const head = [
		`${request.method.toUpperCase()} ${requestPath} HTTP/1.1`,
		...headers.map(([name, value]) => `${name}: ${value}`),
		'',
		''
	].join('\r\n');

	return Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(body)]);
}

export function parseForwardHttpResponse(data: Uint8Array): SshTunnelHttpResponse {
	const buffer = Buffer.from(data);
	const headerEnd = buffer.indexOf('\r\n\r\n');
	if (headerEnd < 0) {
		throw new SshTunnelProxyError(
			'tunnel_proxy_failed',
			'Tunnel target returned an invalid HTTP response'
		);
	}

	const headerText = buffer.subarray(0, headerEnd).toString('latin1');
	const lines = headerText.split('\r\n');
	const statusLine = lines.shift() ?? '';
	const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/.exec(statusLine);
	if (!statusMatch) {
		throw new SshTunnelProxyError(
			'tunnel_proxy_failed',
			'Tunnel target returned an invalid status line'
		);
	}

	const headers = new Headers();
	for (const line of lines) {
		const separator = line.indexOf(':');
		if (separator <= 0) continue;
		const name = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (!name || proxyHopByHopHeaders.has(name.toLowerCase())) continue;
		headers.append(name, value);
	}

	return {
		status: Number(statusMatch[1]),
		statusText: statusMatch[2] ?? '',
		headers,
		body: toArrayBuffer(buffer.subarray(headerEnd + 4))
	};
}

async function readRequestBody(request: Request): Promise<Uint8Array> {
	const length = request.headers.get('content-length');
	if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(maxTunnelRequestBytes)) {
		throw new ServicePayloadTooLargeError('tunnel request exceeds the 25 MiB limit');
	}

	if (request.method === 'GET' || request.method === 'HEAD') return new Uint8Array();
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.byteLength > maxTunnelRequestBytes) {
		throw new ServicePayloadTooLargeError('tunnel request exceeds the 25 MiB limit');
	}
	return body;
}

function proxyRequestHeaders(
	headers: Headers,
	targetHost: string,
	targetPort: number,
	contentLength: number
): Array<[string, string]> {
	const forwarded: Array<[string, string]> = [['Host', hostHeader(targetHost, targetPort)]];

	for (const [name, value] of headers.entries()) {
		const normalized = name.toLowerCase();
		if (proxyHopByHopHeaders.has(normalized)) continue;
		if (sensitiveBrowserHeaders.has(normalized)) continue;
		if (normalized === 'host' || normalized === 'content-length') continue;
		forwarded.push([name, value]);
	}

	if (contentLength > 0) forwarded.push(['Content-Length', String(contentLength)]);
	forwarded.push(['Connection', 'close']);
	return forwarded;
}

function hostHeader(host: string, port: number): string {
	const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	const defaultHttpPort = port === 80;
	return defaultHttpPort ? formattedHost : `${formattedHost}:${port}`;
}

function connectSsh(target: SshTunnelConnectTarget): Promise<Client> {
	const connection = new Client();
	const credential = target.credential;
	let hostKeyTrustError: SshHostKeyTrustError | undefined;
	const config: ConnectConfig = buildTrustedSshConnectConfig(
		{
			host: target.host,
			port: target.port,
			username: credential?.username ?? target.username,
			password: credential?.kind === 'password' ? credential.password : undefined,
			privateKey: credential?.kind === 'ssh_key' ? credential.privateKey : undefined,
			passphrase: credential?.kind === 'ssh_key' ? credential.passphrase : undefined
		},
		{
			userId: target.userId,
			hostId: target.hostId,
			hostname: target.host,
			port: target.port
		},
		{
			onFailure(error) {
				hostKeyTrustError = error;
			}
		}
	);

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			connection.off('ready', onReady);
			connection.off('error', onError);
		};
		const onReady = () => {
			cleanup();
			resolve(connection);
		};
		const onError = (error: Error & { level?: string }) => {
			cleanup();
			if (hostKeyTrustError) reject(new SshTunnelProxyError('ssh_host_key_untrusted'));
			else if (error.level === 'client-authentication')
				reject(new SshTunnelProxyError('ssh_auth_failed'));
			else reject(new SshTunnelProxyError('ssh_connection_failed', error.message));
		};

		connection.once('ready', onReady);
		connection.once('error', onError);
		connection.connect(config);
	});
}

function openForwardChannel(
	connection: Client,
	targetHost: string,
	targetPort: number
): Promise<ClientChannel> {
	return new Promise((resolve, reject) => {
		connection.forwardOut('127.0.0.1', 0, targetHost, targetPort, (error, channel) => {
			if (error) reject(new SshTunnelProxyError('target_unreachable', error.message));
			else resolve(channel);
		});
	});
}

function writeAndRead(channel: ClientChannel, data: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const cleanup = () => {
			channel.off('data', onData);
			channel.off('close', onClose);
			channel.off('error', onError);
		};
		const onData = (chunk: Buffer) => chunks.push(chunk);
		const onClose = () => {
			cleanup();
			resolve(Buffer.concat(chunks));
		};
		const onError = (error: Error) => {
			cleanup();
			reject(new SshTunnelProxyError('tunnel_proxy_failed', error.message));
		};

		channel.on('data', onData);
		channel.once('close', onClose);
		channel.once('error', onError);
		channel.end(data);
	});
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
	return buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength
	) as ArrayBuffer;
}

function rawDataToBuffer(data: RawData): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (data instanceof ArrayBuffer) return Buffer.from(data);
	if (Array.isArray(data)) return Buffer.concat(data);
	return Buffer.from(data as ArrayBuffer);
}

export function tunnelFailureCode(error: unknown): SshTunnelFailureCode {
	if (error instanceof SshTunnelProxyError) return error.code;
	if (error instanceof ServiceValidationError) return 'validation_failed';
	return 'tunnel_proxy_failed';
}
