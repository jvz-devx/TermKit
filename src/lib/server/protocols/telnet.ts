import type { Socket } from 'node:net';
import type { ProtocolAdapter } from './types';
import { connectTcpTarget, proxyTcpBytes } from './tcp';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const NAWS = 31;

export function createTelnetAdapter(): ProtocolAdapter {
	return {
		protocol: 'telnet',
		handle(socket, ticket) {
			const target = connectTcpTarget(ticket.target.host, ticket.target.port);
			installTelnetNegotiation(target);
			proxyTcpBytes(socket, target);
		}
	};
}

export function installTelnetNegotiation(target: Socket): void {
	target.on('data', (chunk) => {
		const response = negotiate(chunk);
		if (response.length > 0) {
			target.write(response);
		}
	});
}

export function negotiate(chunk: Buffer): Buffer {
	const response: number[] = [];

	for (let index = 0; index < chunk.length - 2; index += 1) {
		if (chunk[index] !== IAC) continue;

		const command = chunk[index + 1];
		const option = chunk[index + 2];

		if (command === DO && option === NAWS) {
			response.push(IAC, WILL, NAWS);
			continue;
		}

		if (command === DO) {
			response.push(IAC, WONT, option);
			continue;
		}

		if (command === WILL) {
			response.push(IAC, DONT, option);
		}

		if (command === SB) {
			const end = chunk.indexOf(Buffer.from([IAC, SE]), index + 2);
			index = end === -1 ? chunk.length : end + 1;
		}
	}

	return Buffer.from(response);
}
