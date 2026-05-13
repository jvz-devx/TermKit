import type { Socket } from 'node:net';
import type { ProtocolAdapter } from './types';
import { connectTcpTarget, proxyTcpBytes, type TerminalSize } from './tcp';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const NAWS = 31;
const DEFAULT_TERMINAL_SIZE: TerminalSize = { cols: 80, rows: 24 };

export type TelnetNegotiationState = {
	nawsEnabled: boolean;
	pending: Buffer;
	size: TerminalSize;
};

export function createTelnetAdapter(): ProtocolAdapter {
	return {
		protocol: 'telnet',
		handle(socket, ticket) {
			const target = connectTcpTarget(ticket.target.host, ticket.target.port);
			const negotiation = createTelnetNegotiationState();

			proxyTcpBytes(socket, target, {
				textFrames: 'control',
				onResize(size) {
					writeTelnetNaws(target, negotiation, size);
				},
				transformTargetData(chunk) {
					const result = processTelnetTargetData(chunk, negotiation);
					if (result.response.length > 0) target.write(result.response);
					return result.data;
				}
			});
		}
	};
}

export function installTelnetNegotiation(target: Socket): void {
	const state = createTelnetNegotiationState();
	target.on('data', (chunk) => {
		const response = negotiate(chunk, state);
		if (response.length > 0) {
			target.write(response);
		}
	});
}

export function createTelnetNegotiationState(
	size: TerminalSize = DEFAULT_TERMINAL_SIZE
): TelnetNegotiationState {
	return {
		nawsEnabled: false,
		pending: Buffer.alloc(0),
		size
	};
}

export function negotiate(
	chunk: Buffer,
	state: TelnetNegotiationState = createTelnetNegotiationState()
): Buffer {
	return processTelnetTargetData(chunk, state).response;
}

export function processTelnetTargetData(
	chunk: Buffer,
	state: TelnetNegotiationState = createTelnetNegotiationState()
): { data: Buffer; response: Buffer } {
	const input = state.pending.length > 0 ? Buffer.concat([state.pending, chunk]) : chunk;
	state.pending = Buffer.alloc(0);
	const data: number[] = [];
	const response: number[] = [];

	for (let index = 0; index < input.length; ) {
		if (input[index] !== IAC) {
			data.push(input[index]);
			index += 1;
			continue;
		}

		if (index + 1 >= input.length) {
			state.pending = input.subarray(index);
			break;
		}

		const command = input[index + 1];

		if (command === IAC) {
			data.push(IAC);
			index += 2;
			continue;
		}

		if (command === DO || command === DONT || command === WILL || command === WONT) {
			if (index + 2 >= input.length) {
				state.pending = input.subarray(index);
				break;
			}

			const option = input[index + 2];

			if (command === DO && option === NAWS) {
				if (!state.nawsEnabled) response.push(IAC, WILL, NAWS);
				state.nawsEnabled = true;
				response.push(...encodeTelnetNaws(state.size));
			} else if (command === DONT && option === NAWS) {
				state.nawsEnabled = false;
				response.push(IAC, WONT, NAWS);
			} else if (command === DO) {
				response.push(IAC, WONT, option);
			} else if (command === WILL) {
				response.push(IAC, DONT, option);
			}

			index += 3;
			continue;
		}

		if (command === SB) {
			const end = input.indexOf(Buffer.from([IAC, SE]), index + 2);
			if (end === -1) {
				state.pending = input.subarray(index);
				break;
			}
			index = end + 2;
			continue;
		}

		index += 2;
	}

	return { data: Buffer.from(data), response: Buffer.from(response) };
}

export function writeTelnetNaws(
	target: Pick<Socket, 'write'>,
	state: TelnetNegotiationState,
	size: TerminalSize
): void {
	state.size = size;
	if (state.nawsEnabled) target.write(Buffer.from(encodeTelnetNaws(size)));
}

function encodeTelnetNaws({ cols, rows }: TerminalSize): number[] {
	return [IAC, SB, NAWS, ...encodeTelnetUInt16(cols), ...encodeTelnetUInt16(rows), IAC, SE];
}

function encodeTelnetUInt16(value: number): number[] {
	const bytes = [(value >> 8) & 0xff, value & 0xff];
	return bytes.flatMap((byte) => (byte === IAC ? [IAC, IAC] : [byte]));
}
