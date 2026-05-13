import { Socket, connect } from 'node:net';
import type { WebSocket } from 'ws';

export function connectTcpTarget(host: string, port: number): Socket {
	return connect({ host, port });
}

export function proxyTcpBytes(socket: WebSocket, target: Socket): void {
	const cleanup = () => {
		target.destroy();
		if (socket.readyState === socket.OPEN) {
			socket.close();
		}
	};

	target.on('data', (chunk) => {
		if (socket.readyState === socket.OPEN) {
			socket.send(chunk);
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

	socket.on('message', (data) => {
		if (typeof data === 'string') {
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

export function rawDataToBuffer(data: Buffer | ArrayBuffer): Buffer {
	return Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
}
