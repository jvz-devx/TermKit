import { createServer } from 'node:net';

export const IAC = 255;
export const DO = 253;
export const WILL = 251;
export const SB = 250;
export const SE = 240;
export const NAWS = 31;
export const rfbVersion = Buffer.from('RFB 003.008\n');

export function createTelnetFixtureServer() {
	const sockets = new Set();
	const state = {
		received: Buffer.alloc(0),
		sawProbe: false,
		sawBrowserProbe: false,
		connectionCount: 0,
		closedCount: 0,
		nawsFrames: []
	};
	const server = createServer((socket) => {
		sockets.add(socket);
		state.connectionCount += 1;
		socket.once('close', () => {
			state.closedCount += 1;
			sockets.delete(socket);
		});
		socket.write(Buffer.concat([Buffer.from([IAC, DO, NAWS]), Buffer.from('telnet-ready\r\n')]));
		socket.on('data', (chunk) => {
			state.received = Buffer.concat([state.received, chunk]);
			state.nawsFrames = parseTelnetNawsFrames(state.received);
			if (!state.sawProbe && chunk.includes(Buffer.from('probe\n'))) {
				state.sawProbe = true;
				socket.end('echo:probe\r\n');
			}
			if (!state.sawBrowserProbe && /whoami(?:\r\n|\r|\n)/.test(chunk.toString('utf8'))) {
				state.sawBrowserProbe = true;
				socket.write('echo:whoami\r\n');
			}
		});
	});
	server.closeAllClients = () => {
		for (const socket of sockets) socket.destroy();
		sockets.clear();
	};
	return { server, state };
}

function parseTelnetNawsFrames(buffer) {
	const frames = [];
	for (let index = 0; index <= buffer.length - 9; index += 1) {
		if (
			buffer[index] === IAC &&
			buffer[index + 1] === SB &&
			buffer[index + 2] === NAWS &&
			buffer[index + 7] === IAC &&
			buffer[index + 8] === SE
		) {
			frames.push({
				cols: buffer.readUInt16BE(index + 3),
				rows: buffer.readUInt16BE(index + 5)
			});
			index += 8;
		}
	}
	return frames;
}

export function createVncFixtureServer() {
	const sockets = new Set();
	const state = {
		events: [],
		lastStage: 'idle',
		selectedSecurityType: null,
		authResponseBytes: 0,
		clientVersionCount: 0,
		authResponseCount: 0,
		connectionCount: 0,
		closedCount: 0,
		sawClientVersion: false,
		sawAuthResponse: false
	};
	const server = createServer((socket) => {
		sockets.add(socket);
		state.connectionCount += 1;
		socket.once('close', () => {
			state.closedCount += 1;
			sockets.delete(socket);
		});
		socket.write(rfbVersion);
		recordVncEvent(state, 'server-version-sent');
		let buffer = Buffer.alloc(0);
		let stage = 'version';

		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			state.lastStage = stage;
			recordVncEvent(state, `${stage}:${chunk.length}b`);

			if (stage === 'version' && buffer.length >= rfbVersion.length) {
				state.sawClientVersion = buffer.subarray(0, rfbVersion.length).equals(rfbVersion);
				if (state.sawClientVersion) state.clientVersionCount += 1;
				buffer = buffer.subarray(rfbVersion.length);
				stage = 'security-type';
				state.lastStage = stage;
				socket.write(Buffer.from([1, 2]));
				recordVncEvent(state, 'security-types-sent:vnc-auth');
			}

			if (stage === 'security-type' && buffer.length >= 1) {
				state.selectedSecurityType = buffer[0];
				if (buffer[0] !== 2) {
					recordVncEvent(state, `unsupported-security-type:${buffer[0]}`);
					socket.end();
					return;
				}
				buffer = buffer.subarray(1);
				stage = 'auth-response';
				state.lastStage = stage;
				socket.write(Buffer.from('termkit-vnc-00'));
				recordVncEvent(state, 'challenge-sent');
			}

			if (stage === 'auth-response' && buffer.length >= 16) {
				state.authResponseBytes = buffer.length;
				state.sawAuthResponse = true;
				state.authResponseCount += 1;
				buffer = buffer.subarray(16);
				stage = 'server-init';
				state.lastStage = stage;
				socket.write(Buffer.concat([Buffer.alloc(4), rfbServerInit('TermKit smoke VNC')]));
				recordVncEvent(state, 'auth-response-received');
			}
		});
	});
	server.closeAllClients = () => {
		for (const socket of sockets) socket.destroy();
		sockets.clear();
	};
	return { server, state };
}

function recordVncEvent(state, event) {
	state.events.push(event);
	if (state.events.length > 12) state.events.shift();
}

export function describeVncState(state) {
	return `stage=${state.lastStage} selectedSecurityType=${state.selectedSecurityType ?? '<none>'} authResponseBytes=${state.authResponseBytes} events=${state.events.join(' > ') || '<none>'}`;
}

function rfbServerInit(name) {
	const nameBuffer = Buffer.from(name);
	const pixelFormat = Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
	const header = Buffer.alloc(8);
	header.writeUInt16BE(1, 0);
	header.writeUInt16BE(1, 2);
	header.writeUInt32BE(nameBuffer.length, 4);
	return Buffer.concat([header.subarray(0, 4), pixelFormat, header.subarray(4), nameBuffer]);
}
