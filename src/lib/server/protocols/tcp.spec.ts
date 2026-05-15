import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { parseTerminalControlFrame, proxyTcpBytes, rawDataToBuffer } from './tcp';

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

describe('TCP websocket proxying', () => {
	it('routes target data to the websocket and binary websocket data to the target', () => {
		expect.assertions(5);

		const socket = new FakeWebSocket();
		const target = new FakeSocket();

		proxyTcpBytes(socket as never, target as never);
		target.emit('data', Buffer.from('from-target'));
		socket.emit('message', Buffer.from('from-client'), true);
		socket.emit('message', [Buffer.from('A'), Buffer.from('B')], true);

		expect(socket.send).toHaveBeenCalledWith(Buffer.from('from-target'));
		expect(target.write).toHaveBeenNthCalledWith(1, Buffer.from('from-client'));
		expect(target.write).toHaveBeenNthCalledWith(2, Buffer.from('A'));
		expect(target.write).toHaveBeenNthCalledWith(3, Buffer.from('B'));
		expect(socket.close).not.toHaveBeenCalled();
	});

	it('treats text frames as terminal controls when requested', () => {
		expect.assertions(3);

		const socket = new FakeWebSocket();
		const target = new FakeSocket();
		const onResize = vi.fn();

		proxyTcpBytes(socket as never, target as never, { textFrames: 'control', onResize });
		socket.emit('message', '{"type":"terminal.resize","cols":120,"rows":40}', false);
		socket.emit('message', 'whoami', false);

		expect(onResize).toHaveBeenCalledWith({ type: 'terminal.resize', cols: 120, rows: 40 });
		expect(onResize).toHaveBeenCalledTimes(1);
		expect(target.write).not.toHaveBeenCalled();
	});

	it('supports text data frames and target output transforms', () => {
		expect.assertions(3);

		const socket = new FakeWebSocket();
		const target = new FakeSocket();

		proxyTcpBytes(socket as never, target as never, {
			transformTargetData(chunk) {
				if (chunk.equals(Buffer.from('drop'))) return null;
				return Buffer.from(chunk.toString('utf8').toUpperCase());
			}
		});
		target.emit('data', Buffer.from('ok'));
		target.emit('data', Buffer.from('drop'));
		socket.emit('message', 'typed command', false);

		expect(socket.send).toHaveBeenCalledWith(Buffer.from('OK'));
		expect(socket.send).toHaveBeenCalledTimes(1);
		expect(target.write).toHaveBeenCalledWith('typed command');
	});

	it('closes websocket failures from target errors and destroys the target on websocket cleanup', () => {
		expect.assertions(4);

		const socket = new FakeWebSocket();
		const target = new FakeSocket();

		proxyTcpBytes(socket as never, target as never);
		target.emit('error', new Error('refused'));
		socket.emit('error', new Error('browser reset'));

		expect(socket.close).toHaveBeenCalledWith(1011, 'target connection failed');
		expect(target.destroy).toHaveBeenCalledTimes(1);
		expect(socket.close).toHaveBeenCalledTimes(1);
		expect(target.listenerCount('data')).toBe(0);
	});
});

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
