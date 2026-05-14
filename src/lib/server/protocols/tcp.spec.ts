import { describe, expect, it } from 'vitest';
import { parseTerminalControlFrame, rawDataToBuffer } from './tcp';

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
		expect(parseTerminalControlFrame('[]')).toBeNull();
		expect(parseTerminalControlFrame('{"type":"terminal.input","data":"whoami"}')).toBeNull();
		expect(parseTerminalControlFrame('{"type":"terminal.resize","cols":0,"rows":24}')).toBeNull();
		expect(
			parseTerminalControlFrame('{"type":"terminal.resize","cols":80.5,"rows":24}')
		).toBeNull();
		expect(
			parseTerminalControlFrame('{"type":"terminal.resize","cols":80,"rows":65536}')
		).toBeNull();
		expect(
			parseTerminalControlFrame('{"type":"terminal.resize","cols":80,"rows":"24"}')
		).toBeNull();
	});
});

describe('websocket raw data normalization', () => {
	it('normalizes every ws raw data shape to a Buffer', () => {
		const arrayBuffer = new Uint8Array([67, 68]).buffer;

		expect(rawDataToBuffer(Buffer.from('AB'))).toEqual(Buffer.from('AB'));
		expect(rawDataToBuffer(arrayBuffer)).toEqual(Buffer.from('CD'));
		expect(rawDataToBuffer([Buffer.from('EF'), Buffer.from('GH')])).toEqual(Buffer.from('EFGH'));
		expect(rawDataToBuffer('IJ')).toEqual(Buffer.from('IJ'));
	});
});
