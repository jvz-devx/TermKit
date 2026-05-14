import { describe, expect, it } from 'vitest';
import { createTelnetNegotiationState, processTelnetTargetData, writeTelnetNaws } from './telnet';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const NAWS = 31;

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

	it('rejects unsupported options and removes subnegotiation bytes from terminal data', () => {
		const state = createTelnetNegotiationState();
		const result = processTelnetTargetData(
			Buffer.from([72, IAC, DO, 1, IAC, WILL, 3, IAC, SB, 24, 1, 2, IAC, SE, 105]),
			state
		);

		expect(result.data).toEqual(Buffer.from([72, 105]));
		expect([...result.response]).toEqual([IAC, WONT, 1, IAC, DONT, 3]);
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
});
