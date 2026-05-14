import { Client, type ConnectConfig } from 'ssh2';
import type { WebSocket } from 'ws';
import {
	buildTrustedSshConnectConfig,
	type SshHostKeyTrustError
} from '../protocols/ssh-host-trust';
import { connectTrustedSsh } from '../protocols/ssh-connect';
import type { ConsumedTicket } from '../protocols/types';
import { parseTerminalControlFrame, rawDataToBuffer, type TerminalSize } from '../protocols/tcp';
import type { SshAttachTicket } from './types';

const DEFAULT_TERMINAL_SIZE: TerminalSize = { cols: 80, rows: 24 };
const DEFAULT_SCROLLBACK_BYTES = 1024 * 1024;

export type LiveSshManagerOptions = {
	scrollbackBytes?: number;
	createClient?: LiveSshClientFactory;
};

export type LiveSshClientFactory = () => LiveSshClient;

export type LiveSshAttachResult = {
	sessionId: string;
	detach: () => void;
	close: () => void;
};

export type LiveSshStatus = 'starting' | 'open' | 'closed';

type LiveSshCloseReason = 'explicit' | 'remote' | 'connection_error' | 'shell_error';

export type LiveSshCloseEvent = {
	sessionId: string;
	userId: string;
	reason: LiveSshCloseReason;
	hadActiveAttachment: boolean;
};

type LiveSshControlFrame =
	| { type: 'terminal.resize'; cols: number; rows: number }
	| { type: 'terminal.close' }
	| { type: 'terminal.control'; action: 'close' | 'detach' };

type LiveSshSessionOptions = {
	ticket: ConsumedTicket;
	scrollbackBytes: number;
	createClient: LiveSshClientFactory;
	onClose: (event: LiveSshCloseEvent) => void;
	terminalSize?: TerminalSize;
};

export interface LiveSshClient {
	on(event: 'ready', listener: () => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	on(event: 'close' | 'end', listener: () => void): this;
	connect(config: ConnectConfig): void;
	shell(
		options: {
			term: string;
			cols: number;
			rows: number;
			width: number;
			height: number;
		},
		callback: (error: Error | undefined, stream: LiveSshChannel) => void
	): void;
	end(): void;
}

export interface LiveSshChannel {
	on(event: 'data', listener: (chunk: Buffer) => void): this;
	on(event: 'close' | 'end', listener: () => void): this;
	on(event: 'error', listener: (error: Error) => void): this;
	write(chunk: Buffer): void;
	setWindow(rows: number, cols: number, height: number, width: number): void;
	end(): void;
}

export class LiveSshAttachError extends Error {
	constructor(
		message: string,
		readonly code: 'session_not_found' | 'session_closed' | 'active_attachment'
	) {
		super(message);
		this.name = 'LiveSshAttachError';
	}
}

export class LiveSshManager {
	private readonly sessions = new Map<string, LiveSshSession>();
	private readonly closeListeners = new Set<(event: LiveSshCloseEvent) => void>();
	private readonly scrollbackBytes: number;
	private readonly createClient: LiveSshClientFactory;

	constructor({
		scrollbackBytes = DEFAULT_SCROLLBACK_BYTES,
		createClient = createSshClient
	}: LiveSshManagerOptions = {}) {
		this.scrollbackBytes = Math.max(1, scrollbackBytes);
		this.createClient = createClient;
	}

	start(ticket: ConsumedTicket): LiveSshSession {
		return this.startWithSize(ticket);
	}

	startWithSize(ticket: ConsumedTicket, terminalSize?: TerminalSize): LiveSshSession {
		this.assertSshTicket(ticket);
		const existing = this.sessions.get(ticket.ticketId);
		if (existing && existing.status !== 'closed') return existing;

		const session = new LiveSshSession({
			ticket,
			scrollbackBytes: this.scrollbackBytes,
			createClient: this.createClient,
			onClose: (event) => {
				const sessionId = event.sessionId;
				if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
				for (const listener of this.closeListeners) listener(event);
			},
			terminalSize
		});
		this.sessions.set(ticket.ticketId, session);
		return session;
	}

	handle(socket: WebSocket, attachTicket: SshAttachTicket): LiveSshAttachResult {
		const sessionTicket: ConsumedTicket = {
			...attachTicket.session,
			ticketId: attachTicket.sshLiveSessionId
		};
		const session = this.startWithSize(sessionTicket, {
			cols: attachTicket.terminalCols,
			rows: attachTicket.terminalRows
		});
		return session.attach(socket);
	}

	attach(ticketOrSessionId: ConsumedTicket | string, socket: WebSocket): LiveSshAttachResult {
		const session =
			typeof ticketOrSessionId === 'string'
				? this.getOpenSession(ticketOrSessionId)
				: this.start(ticketOrSessionId);

		return session.attach(socket);
	}

	detach(sessionId: string, socket?: WebSocket): boolean {
		return this.sessions.get(sessionId)?.detach(socket) ?? false;
	}

	close(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		session.close();
		return true;
	}

	get(sessionId: string): LiveSshSession | undefined {
		return this.sessions.get(sessionId);
	}

	hasActiveAttachment(sessionId: string): boolean {
		return this.sessions.get(sessionId)?.hasActiveAttachment() ?? false;
	}

	onSessionClose(listener: (event: LiveSshCloseEvent) => void): () => void {
		this.closeListeners.add(listener);
		return () => {
			this.closeListeners.delete(listener);
		};
	}

	private getOpenSession(sessionId: string): LiveSshSession {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new LiveSshAttachError('Live SSH session was not found', 'session_not_found');
		}
		if (session.status === 'closed') {
			throw new LiveSshAttachError('Live SSH session is closed', 'session_closed');
		}
		return session;
	}

	private assertSshTicket(ticket: ConsumedTicket): void {
		if (ticket.protocol !== 'ssh') {
			throw new LiveSshAttachError('Live SSH sessions require an SSH ticket', 'session_not_found');
		}
	}
}

export class LiveSshSession {
	readonly id: string;
	status: LiveSshStatus = 'starting';

	private readonly ticket: ConsumedTicket;
	private client: LiveSshClient;
	private readonly scrollbackBytes: number;
	private readonly onClose: (event: LiveSshCloseEvent) => void;
	private readonly scrollback: Buffer[] = [];
	private scrollbackSize = 0;
	private terminalSize: TerminalSize = { ...DEFAULT_TERMINAL_SIZE };
	private stream: LiveSshChannel | undefined;
	private socket: WebSocket | undefined;
	private closed = false;
	private hostKeyTrustError: SshHostKeyTrustError | undefined;

	constructor({
		ticket,
		scrollbackBytes,
		createClient,
		onClose,
		terminalSize
	}: LiveSshSessionOptions) {
		this.id = ticket.ticketId;
		this.ticket = ticket;
		this.scrollbackBytes = scrollbackBytes;
		this.onClose = onClose;
		this.client = createClient();
		if (terminalSize) this.terminalSize = terminalSize;
		this.start();
	}

	attach(socket: WebSocket): LiveSshAttachResult {
		if (this.closed) {
			throw new LiveSshAttachError('Live SSH session is closed', 'session_closed');
		}
		if (this.hasOpenAttachment()) {
			const previousSocket = this.socket;
			this.detach(previousSocket);
			previousSocket?.close(1000, 'ssh session reattached');
		}

		this.socket = socket;
		this.replayScrollback(socket);

		const onMessage = (data: Buffer | ArrayBuffer | Buffer[] | string, isBinary: boolean) => {
			this.handleSocketMessage(socket, data, isBinary);
		};
		const onClose = () => {
			this.detach(socket);
		};
		const onError = () => {
			this.detach(socket);
		};

		socket.on('message', onMessage);
		socket.on('close', onClose);
		socket.on('error', onError);

		return {
			sessionId: this.id,
			detach: () => {
				socket.off('message', onMessage);
				socket.off('close', onClose);
				socket.off('error', onError);
				this.detach(socket);
			},
			close: () => {
				this.close();
			}
		};
	}

	detach(socket?: WebSocket): boolean {
		if (socket && this.socket !== socket) return false;
		if (!this.socket) return false;
		this.socket = undefined;
		return true;
	}

	close(): void {
		this.finish('explicit');
	}

	private start(): void {
		if (this.ticket.target.jumpHost) {
			void this.startWithJumpHost();
			return;
		}

		this.client
			.on('ready', () => {
				this.openShell();
			})
			.on('error', () => {
				this.closeSocket(
					1011,
					this.hostKeyTrustError ? 'ssh host key not trusted' : 'ssh connection failed'
				);
				this.finish('connection_error');
			})
			.on('close', () => {
				this.finish('remote');
			})
			.on('end', () => {
				this.finish('remote');
			});

		this.client.connect(this.connectConfig());
	}

	private async startWithJumpHost(): Promise<void> {
		try {
			const client = await connectTrustedSsh(
				{
					userId: this.ticket.userId,
					hostId: this.ticket.hostId,
					...this.ticket.target
				},
				{
					onHostKeyTrustFailure: (error) => {
						this.hostKeyTrustError = error;
					}
				}
			);
			if (this.closed) {
				client.end();
				return;
			}
			this.client = client as unknown as LiveSshClient;
			this.client
				.on('error', () => {
					this.closeSocket(
						1011,
						this.hostKeyTrustError ? 'ssh host key not trusted' : 'ssh connection failed'
					);
					this.finish('connection_error');
				})
				.on('close', () => {
					this.finish('remote');
				})
				.on('end', () => {
					this.finish('remote');
				});
			this.openShell();
		} catch {
			this.closeSocket(
				1011,
				this.hostKeyTrustError ? 'ssh host key not trusted' : 'ssh connection failed'
			);
			this.finish('connection_error');
		}
	}

	private openShell(): void {
		this.client.shell(
			{
				term: 'xterm-256color',
				cols: this.terminalSize.cols,
				rows: this.terminalSize.rows,
				width: 0,
				height: 0
			},
			(error, stream) => {
				if (this.closed) {
					stream?.end();
					return;
				}
				if (error) {
					this.closeSocket(1011, 'ssh shell failed');
					this.finish('shell_error');
					return;
				}

				this.status = 'open';
				this.stream = stream;
				stream
					.on('data', (chunk) => {
						this.handleStreamData(chunk);
					})
					.on('close', () => {
						this.finish('remote');
					})
					.on('end', () => {
						this.finish('remote');
					})
					.on('error', () => {
						this.closeSocket(1011, 'ssh shell failed');
						this.finish('shell_error');
					});
			}
		);
	}

	private handleStreamData(chunk: Buffer): void {
		this.appendScrollback(chunk);
		if (this.socket && this.socket.readyState === this.socket.OPEN) {
			this.socket.send(chunk);
		}
	}

	private handleSocketMessage(
		socket: WebSocket,
		data: Buffer | ArrayBuffer | Buffer[] | string,
		isBinary: boolean
	): void {
		if (this.socket !== socket) return;

		if (!isBinary) {
			const control = parseLiveSshControlFrame(rawDataToBuffer(data).toString('utf8'));
			if (control?.type === 'terminal.resize') {
				this.terminalSize = { cols: control.cols, rows: control.rows };
				this.stream?.setWindow(control.rows, control.cols, 0, 0);
				return;
			}
			if (isDetachFrame(control)) {
				this.detach(socket);
				return;
			}
			if (isCloseFrame(control)) {
				this.finish('explicit');
				return;
			}
			return;
		}

		if (Array.isArray(data)) {
			for (const chunk of data) this.stream?.write(chunk);
			return;
		}

		this.stream?.write(rawDataToBuffer(data));
	}

	private appendScrollback(chunk: Buffer): void {
		const stored =
			chunk.length > this.scrollbackBytes
				? chunk.subarray(chunk.length - this.scrollbackBytes)
				: chunk;
		this.scrollback.push(stored);
		this.scrollbackSize += stored.length;

		while (this.scrollbackSize > this.scrollbackBytes && this.scrollback.length > 0) {
			const first = this.scrollback[0];
			const overflow = this.scrollbackSize - this.scrollbackBytes;
			if (first.length <= overflow) {
				this.scrollback.shift();
				this.scrollbackSize -= first.length;
				continue;
			}

			this.scrollback[0] = first.subarray(overflow);
			this.scrollbackSize -= overflow;
			break;
		}
	}

	private replayScrollback(socket: WebSocket): void {
		if (socket.readyState !== socket.OPEN) return;
		for (const chunk of this.scrollback) socket.send(chunk);
	}

	private finish(reason: LiveSshCloseReason): void {
		if (this.closed) return;
		this.closed = true;
		this.status = 'closed';
		const socket = this.socket;
		const hadActiveAttachment = socket !== undefined && socket.readyState === socket.OPEN;
		this.socket = undefined;

		if (reason === 'explicit') {
			this.stream?.end();
		}

		if (reason !== 'remote') {
			this.client.end();
		}

		if (socket && socket.readyState === socket.OPEN) {
			socket.close(
				reason === 'explicit' || reason === 'remote' ? 1000 : 1011,
				closeMessage(reason)
			);
		}

		this.onClose({
			sessionId: this.id,
			userId: this.ticket.userId,
			reason,
			hadActiveAttachment
		});
	}

	private closeSocket(code: number, reason: string): void {
		if (this.socket && this.socket.readyState === this.socket.OPEN) {
			this.socket.close(code, reason);
		}
	}

	hasActiveAttachment(): boolean {
		return this.socket !== undefined && this.socket.readyState === this.socket.OPEN;
	}

	private hasOpenAttachment(): boolean {
		return this.hasActiveAttachment();
	}

	private connectConfig(): ConnectConfig {
		const credential = this.ticket.target.credential;
		const username = credential?.username ?? this.ticket.target.username;
		return buildTrustedSshConnectConfig(
			{
				host: this.ticket.target.host,
				port: this.ticket.target.port,
				username,
				password: credential?.kind === 'password' ? credential.password : undefined,
				privateKey: credential?.kind === 'ssh_key' ? credential.privateKey : undefined,
				passphrase: credential?.kind === 'ssh_key' ? credential.passphrase : undefined
			},
			{
				userId: this.ticket.userId,
				hostId: this.ticket.hostId,
				hostname: this.ticket.target.host,
				port: this.ticket.target.port
			},
			{
				onFailure: (error) => {
					this.hostKeyTrustError = error;
				}
			}
		);
	}
}

export const liveSshManager = new LiveSshManager();

function createSshClient(): LiveSshClient {
	return new Client() as unknown as LiveSshClient;
}

function parseLiveSshControlFrame(data: string): LiveSshControlFrame | null {
	const resize = parseTerminalControlFrame(data);
	if (resize) return resize;

	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
	const frame = parsed as Partial<LiveSshControlFrame>;

	if (frame.type === 'terminal.close') return { type: 'terminal.close' };
	if (
		frame.type === 'terminal.control' &&
		(frame.action === 'close' || frame.action === 'detach')
	) {
		return { type: 'terminal.control', action: frame.action };
	}

	return null;
}

function isCloseFrame(frame: LiveSshControlFrame | null): boolean {
	return (
		frame?.type === 'terminal.close' ||
		(frame?.type === 'terminal.control' && frame.action === 'close')
	);
}

function isDetachFrame(frame: LiveSshControlFrame | null): boolean {
	return frame?.type === 'terminal.control' && frame.action === 'detach';
}

function closeMessage(reason: LiveSshCloseReason): string {
	if (reason === 'explicit') return 'ssh session closed';
	if (reason === 'remote') return 'ssh shell closed';
	if (reason === 'shell_error') return 'ssh shell failed';
	return 'ssh connection failed';
}
