import { Socket, connect } from 'node:net';
import type { WebSocket } from 'ws';

export type TerminalSize = {
	cols: number;
	rows: number;
};

export type TerminalControlFrame = {
	type: 'terminal.resize';
	cols: number;
	rows: number;
};

type TcpProxyOptions = {
	onResize?: (size: TerminalSize) => void;
	textFrames?: 'control' | 'data';
	transformTargetData?: (chunk: Buffer) => Buffer | null | undefined;
};

export function connectTcpTarget(host: string, port: number): Socket {
	return connect({ host, port });
}

export function proxyTcpBytes(
	socket: WebSocket,
	target: Socket,
	{ onResize, textFrames = 'data', transformTargetData }: TcpProxyOptions = {}
): void {
	const cleanup = () => {
		target.destroy();
		if (socket.readyState === socket.OPEN) {
			socket.close();
		}
	};

	target.on('data', (chunk) => {
		const transformed = transformTargetData ? transformTargetData(chunk) : chunk;
		if (!transformed || transformed.length === 0) return;

		if (socket.readyState === socket.OPEN) {
			socket.send(transformed);
		}
	});

	target.on('error', () => {
		if (socket.readyState === socket.OPEN) {
			socket.close(1011, 'target connection failed');
		}
	});

	target.on('close', () => {
		if (socket.readyState === socket.OPEN) {
			socket.close(1000, 'target closed');
		}
	});

	socket.on('message', (data, isBinary) => {
		if (!isBinary && textFrames === 'control') {
			const control = parseTerminalControlFrame(rawDataToBuffer(data).toString('utf8'));
			if (control?.type === 'terminal.resize') onResize?.(control);
			return;
		}

		if (!isBinary && typeof data === 'string') {
			target.write(data);
			return;
		}

		if (Array.isArray(data)) {
			for (const chunk of data) {
				target.write(chunk);
			}
			return;
		}

		target.write(rawDataToBuffer(data));
	});

	socket.on('close', cleanup);
	socket.on('error', cleanup);
}

export function parseTerminalControlFrame(data: string): TerminalControlFrame | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
	const frame = parsed as Partial<TerminalControlFrame>;
	if (frame.type !== 'terminal.resize') return null;
	if (!isTerminalDimension(frame.cols) || !isTerminalDimension(frame.rows)) return null;

	return {
		type: 'terminal.resize',
		cols: frame.cols,
		rows: frame.rows
	};
}

export function rawDataToBuffer(data: Buffer | ArrayBuffer | Buffer[] | string): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (Array.isArray(data)) return Buffer.concat(data);
	if (typeof data === 'string') return Buffer.from(data, 'utf8');
	return Buffer.from(new Uint8Array(data));
}

function isTerminalDimension(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}
