import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createTelnetAdapter,
	createTelnetNegotiationState,
	installTelnetNegotiation,
	processTelnetTargetData,
	writeTelnetNaws
} from './telnet';
import type { ConsumedTicket } from './types';

const tcpMocks = vi.hoisted(() => ({
	connectTcpTarget: vi.fn()
}));

vi.mock('./tcp', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./tcp')>();

	return {
		...actual,
		connectTcpTarget: tcpMocks.connectTcpTarget
	};
});

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const NAWS = 31;
const ECHO = 1;
const SUPPRESS_GO_AHEAD = 3;

beforeEach(() => {
	tcpMocks.connectTcpTarget.mockReset();
});

describe('telnet negotiation', () => {
	it('strips negotiation bytes, accepts NAWS, and emits the current terminal size', () => {
		const state = createTelnetNegotiationState({ cols: 120, rows: 40 });
		const result = processTelnetTargetData(Buffer.from([72, 105, IAC, DO, NAWS, 13, 10]), state);

		expect(result.data).toEqual(Buffer.from([72, 105, 13, 10]));
		expect([...result.response]).toEqual([IAC, WILL, NAWS, IAC, SB, NAWS, 0, 120, 0, 40, IAC, SE]);
		expect(state.nawsEnabled).toBe(true);
	});

	it('writes NAWS updates after the server enables the option', () => {
		const state = createTelnetNegotiationState();
		const writes: Buffer[] = [];

		processTelnetTargetData(Buffer.from([IAC, DO, NAWS]), state);
		writeTelnetNaws({ write: (chunk: Buffer) => writes.push(chunk) } as never, state, {
			cols: 132,
			rows: 43
		});

		expect(writes.map((chunk) => [...chunk])).toEqual([[IAC, SB, NAWS, 0, 132, 0, 43, IAC, SE]]);
	});

	it('buffers partial IAC sequences across target chunks', () => {
		const state = createTelnetNegotiationState({ cols: 100, rows: 30 });

		const first = processTelnetTargetData(Buffer.from([65, IAC]), state);
		const second = processTelnetTargetData(Buffer.from([DO, NAWS, 66]), state);

		expect(first.data).toEqual(Buffer.from([65]));
		expect(first.response).toEqual(Buffer.alloc(0));
		expect(second.data).toEqual(Buffer.from([66]));
		expect([...second.response]).toEqual([IAC, WILL, NAWS, IAC, SB, NAWS, 0, 100, 0, 30, IAC, SE]);
	});

	it('buffers partial option commands until the option byte arrives', () => {
		const state = createTelnetNegotiationState({ cols: 90, rows: 25 });

		const first = processTelnetTargetData(Buffer.from([IAC, DO]), state);
		const second = processTelnetTargetData(Buffer.from([NAWS, 65]), state);

		expect(first.data).toEqual(Buffer.alloc(0));
		expect(first.response).toEqual(Buffer.alloc(0));
		expect(second.data).toEqual(Buffer.from([65]));
		expect([...second.response]).toEqual([IAC, WILL, NAWS, IAC, SB, NAWS, 0, 90, 0, 25, IAC, SE]);
	});

	it('rejects unsupported options and removes subnegotiation bytes from terminal data', () => {
		const state = createTelnetNegotiationState();
		const result = processTelnetTargetData(
			Buffer.from([
				72,
				IAC,
				DO,
				ECHO,
				IAC,
				WILL,
				SUPPRESS_GO_AHEAD,
				IAC,
				SB,
				24,
				1,
				2,
				IAC,
				SE,
				105
			]),
			state
		);

		expect(result.data).toEqual(Buffer.from([72, 105]));
		expect([...result.response]).toEqual([IAC, WONT, ECHO, IAC, DONT, SUPPRESS_GO_AHEAD]);
	});

	it('buffers subnegotiation frames across chunks and drops them from terminal data', () => {
		const state = createTelnetNegotiationState();

		const first = processTelnetTargetData(Buffer.from([72, IAC, SB, 24, 1, 2]), state);
		const second = processTelnetTargetData(Buffer.from([3, IAC, SE, 105]), state);

		expect(first.data).toEqual(Buffer.from([72]));
		expect(first.response).toEqual(Buffer.alloc(0));
		expect(second.data).toEqual(Buffer.from([105]));
		expect(second.response).toEqual(Buffer.alloc(0));
	});

	it('ignores DONT and WONT for unsupported options without leaking control bytes', () => {
		const state = createTelnetNegotiationState();
		const result = processTelnetTargetData(
			Buffer.from([65, IAC, DONT, ECHO, IAC, WONT, SUPPRESS_GO_AHEAD, 66]),
			state
		);

		expect(result.data).toEqual(Buffer.from([65, 66]));
		expect(result.response).toEqual(Buffer.alloc(0));
	});

	it('disables NAWS on DONT and does not write resize frames while disabled', () => {
		const state = createTelnetNegotiationState();
		const writes: Buffer[] = [];

		processTelnetTargetData(Buffer.from([IAC, DO, NAWS]), state);
		const result = processTelnetTargetData(Buffer.from([IAC, DONT, NAWS]), state);
		writeTelnetNaws({ write: (chunk: Buffer) => writes.push(chunk) } as never, state, {
			cols: 90,
			rows: 25
		});

		expect(result.data).toEqual(Buffer.alloc(0));
		expect([...result.response]).toEqual([IAC, WONT, NAWS]);
		expect(state.nawsEnabled).toBe(false);
		expect(writes).toEqual([]);
	});

	it('escapes literal IAC bytes in terminal data and encoded NAWS dimensions', () => {
		const state = createTelnetNegotiationState();
		const writes: Buffer[] = [];

		const data = processTelnetTargetData(Buffer.from([65, IAC, IAC, 66]), state);
		processTelnetTargetData(Buffer.from([IAC, DO, NAWS]), state);
		writeTelnetNaws({ write: (chunk: Buffer) => writes.push(chunk) } as never, state, {
			cols: 255,
			rows: 511
		});

		expect(data.data).toEqual(Buffer.from([65, IAC, 66]));
		expect([...writes[0]]).toEqual([IAC, SB, NAWS, 0, IAC, IAC, 1, IAC, IAC, IAC, SE]);
	});

	it('installs fixture-backed negotiation on target socket data events', () => {
		const target = new FakeSocket();

		installTelnetNegotiation(target as never);
		target.emit('data', Buffer.from([IAC, DO, NAWS]));

		expect(target.write).toHaveBeenCalledWith(
			Buffer.from([IAC, WILL, NAWS, IAC, SB, NAWS, 0, 80, 0, 24, IAC, SE])
		);
	});
});

describe('telnet protocol adapter', () => {
	it('connects to the ticket target and forwards parsed target text to the websocket', () => {
		const socket = new FakeWebSocket();
		const target = new FakeSocket();
		tcpMocks.connectTcpTarget.mockReturnValue(target);

		createTelnetAdapter().handle(socket as never, telnetTicket());
		target.emit('data', Buffer.from([87, 101, 108, 99, 111, 109, 101, IAC, DO, ECHO, 10]));

		expect(tcpMocks.connectTcpTarget).toHaveBeenCalledWith('telnet.example.test', 23);
		expect(socket.send).toHaveBeenCalledWith(Buffer.from('Welcome\n'));
		expect(target.write).toHaveBeenCalledWith(Buffer.from([IAC, WONT, ECHO]));
	});

	it('parses websocket resize controls into NAWS frames after negotiation enables NAWS', () => {
		const socket = new FakeWebSocket();
		const target = new FakeSocket();
		tcpMocks.connectTcpTarget.mockReturnValue(target);

		createTelnetAdapter().handle(socket as never, telnetTicket());
		target.emit('data', Buffer.from([IAC, DO, NAWS]));
		socket.emit('message', '{"type":"terminal.resize","cols":132,"rows":43}', false);

		expect(target.write).toHaveBeenNthCalledWith(
			1,
			Buffer.from([IAC, WILL, NAWS, IAC, SB, NAWS, 0, 80, 0, 24, IAC, SE])
		);
		expect(target.write).toHaveBeenNthCalledWith(
			2,
			Buffer.from([IAC, SB, NAWS, 0, 132, 0, 43, IAC, SE])
		);
	});

	it('forwards binary websocket input to the target and treats text frames as controls', () => {
		const socket = new FakeWebSocket();
		const target = new FakeSocket();
		tcpMocks.connectTcpTarget.mockReturnValue(target);

		createTelnetAdapter().handle(socket as never, telnetTicket());
		socket.emit('message', Buffer.from('whoami\r'), true);
		socket.emit('message', 'plain text terminal input', false);

		expect(target.write).toHaveBeenCalledTimes(1);
		expect(target.write).toHaveBeenCalledWith(Buffer.from('whoami\r'));
	});

	it('maps target timeout and connection failures to the websocket failure close reason', () => {
		const timeout = createAdapterHarness();
		const refused = createAdapterHarness();

		timeout.target.emit('error', Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
		refused.target.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));

		expect(timeout.socket.close).toHaveBeenCalledWith(1011, 'target connection failed');
		expect(refused.socket.close).toHaveBeenCalledWith(1011, 'target connection failed');
	});

	it('destroys the target and removes proxy listeners when the websocket closes or errors', () => {
		const closed = createAdapterHarness();
		const errored = createAdapterHarness();

		closed.socket.emit('close');
		errored.socket.emit('error', new Error('browser reset'));

		expect(closed.target.destroy).toHaveBeenCalledTimes(1);
		expect(errored.target.destroy).toHaveBeenCalledTimes(1);
		expect(closed.target.listenerCount('data')).toBe(0);
		expect(closed.socket.listenerCount('message')).toBe(0);
	});
});

function createAdapterHarness(): { socket: FakeWebSocket; target: FakeSocket } {
	const socket = new FakeWebSocket();
	const target = new FakeSocket();
	tcpMocks.connectTcpTarget.mockReturnValue(target);

	createTelnetAdapter().handle(socket as never, telnetTicket());

	return { socket, target };
}

function telnetTicket(): ConsumedTicket {
	return {
		ticketId: 'ticket-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'telnet',
		target: {
			host: 'telnet.example.test',
			port: 23
		}
	};
}

class FakeWebSocket extends EventEmitter {
	readonly OPEN = 1;
	readyState = this.OPEN;
	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = 3;
	});
}

class FakeSocket extends EventEmitter {
	write = vi.fn();
	destroy = vi.fn();
}
