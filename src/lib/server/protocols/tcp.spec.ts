import { describe, expect, it } from 'vitest';
import { parseTerminalControlFrame } from './tcp';

describe('terminal websocket control frames', () => {
	it('parses resize control frames', () => {
		expect(parseTerminalControlFrame('{"type":"terminal.resize","cols":132,"rows":43}')).toEqual({
			type: 'terminal.resize',
			cols: 132,
			rows: 43
		});
	});

	it('rejects shell input and malformed resize frames', () => {
		expect(parseTerminalControlFrame('ls -la')).toBeNull();
		expect(parseTerminalControlFrame('{"type":"terminal.resize","cols":0,"rows":24}')).toBeNull();
		expect(
			parseTerminalControlFrame('{"type":"terminal.resize","cols":80,"rows":"24"}')
		).toBeNull();
	});
});
