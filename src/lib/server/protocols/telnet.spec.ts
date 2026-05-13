import { describe, expect, it } from 'vitest';
import { createTelnetNegotiationState, processTelnetTargetData, writeTelnetNaws } from './telnet';

const IAC = 255;
const DO = 253;
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
});
