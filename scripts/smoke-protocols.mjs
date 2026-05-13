import { createRequire } from 'node:module';
import { constants as fsConstants } from 'node:fs';
import { connect, createServer } from 'node:net';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const { Client, Server: SshServer, utils } = require('ssh2');

const { STATUS_CODE } = utils.sftp;
const IAC = 255;
const DO = 253;
const WILL = 251;
const SB = 250;
const SE = 240;
const NAWS = 31;
const probeTimeoutMs = Number(process.env.TERMIXKIT_SMOKE_PROTOCOL_TIMEOUT_MS ?? 7000);

const results = [];

try {
	await runSmoke('telnet loopback negotiation', smokeTelnet);
	await runSmoke('vnc loopback rfb banner', smokeVnc);
	await runSmoke('ssh shell and sftp loopback', smokeSshAndSftp);
	skipSmoke(
		'vnc framebuffer authentication',
		'requires a real VNC desktop/server; local smoke verifies the RFB TCP banner only'
	);

	for (const result of results) {
		const suffix = result.detail ? ` - ${result.detail}` : '';
		console.log(`${result.status} ${result.name}${suffix}`);
	}
} catch (error) {
	for (const result of results) {
		const suffix = result.detail ? ` - ${result.detail}` : '';
		console.error(`${result.status} ${result.name}${suffix}`);
	}
	console.error(error instanceof Error ? error.stack || error.message : error);
	process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);

async function runSmoke(name, callback) {
	const cleanup = [];
	await withTimeout(callback({ cleanup }), name, cleanup);
	results.push({ status: '[pass]', name });
}

function skipSmoke(name, detail) {
	results.push({ status: '[skip]', name, detail });
}

async function smokeTelnet({ cleanup }) {
	const serverState = {
		received: Buffer.alloc(0),
		sawProbe: false
	};
	const server = createServer((socket) => {
		let closed = false;
		socket.write(Buffer.concat([Buffer.from([IAC, DO, NAWS]), Buffer.from('telnet-ready\r\n')]));
		socket.on('data', (chunk) => {
			serverState.received = Buffer.concat([serverState.received, chunk]);
			if (!closed && chunk.includes(Buffer.from('probe\n'))) {
				closed = true;
				serverState.sawProbe = true;
				socket.end('echo:probe\r\n');
			}
		});
	});
	cleanup.push(() => closeServer(server));

	await listen(server);

	let socket;
	try {
		socket = connect(server.address().port, '127.0.0.1');
		cleanup.push(() => destroySocket(socket));
		let visibleText = '';
		let sentProbe = false;

		socket.on('data', (chunk) => {
			const { data, response } = negotiateTelnet(chunk, { cols: 132, rows: 43 });
			if (response.length > 0) socket.write(response);
			visibleText += data.toString('utf8');
			if (!sentProbe && visibleText.includes('telnet-ready')) {
				sentProbe = true;
				socket.write('probe\n');
			}
		});

		await once(socket, 'close');

		assert(visibleText.includes('echo:probe'), 'telnet probe did not receive echoed payload');
		assert(serverState.sawProbe, 'telnet server did not receive probe input');
		assert(
			bufferIncludes(serverState.received, Buffer.from([IAC, WILL, NAWS])),
			'telnet client did not accept NAWS negotiation'
		);
		assert(
			bufferIncludes(serverState.received, Buffer.from([IAC, SB, NAWS, 0, 132, 0, 43, IAC, SE])),
			'telnet client did not send terminal dimensions'
		);
	} finally {
		destroySocket(socket);
		await closeServer(server);
	}
}

async function smokeVnc({ cleanup }) {
	const rfbVersion = Buffer.from('RFB 003.008\n');
	const serverState = { sawClientVersion: false };
	const server = createServer((socket) => {
		socket.write(rfbVersion);
		socket.once('data', (chunk) => {
			serverState.sawClientVersion = chunk.equals(rfbVersion);
			socket.end();
		});
	});
	cleanup.push(() => closeServer(server));

	await listen(server);

	let socket;
	try {
		socket = connect(server.address().port, '127.0.0.1');
		cleanup.push(() => destroySocket(socket));
		let banner = Buffer.alloc(0);

		socket.on('data', (chunk) => {
			banner = Buffer.concat([banner, chunk]);
			if (banner.length >= rfbVersion.length) socket.write(rfbVersion);
		});

		await once(socket, 'close');

		assert(banner.subarray(0, rfbVersion.length).equals(rfbVersion), 'VNC server banner mismatch');
		assert(serverState.sawClientVersion, 'VNC client did not answer with an RFB version');
	} finally {
		destroySocket(socket);
		await closeServer(server);
	}
}

async function smokeSshAndSftp({ cleanup }) {
	const server = createSshSmokeServer();
	cleanup.push(() => closeServer(server));
	await listen(server);

	const client = new Client();
	cleanup.push(() => destroySshClient(client));
	try {
		await connectSshClient(client, server.address().port);
		await smokeSshShell(client);
		await smokeSftpList(client);
	} finally {
		destroySshClient(client);
		await closeServer(server);
	}
}

function createSshSmokeServer() {
	const hostKeys = [utils.generateKeyPairSync('ed25519').private];
	const clients = new Set();

	const server = new SshServer({ hostKeys }, (client) => {
		clients.add(client);
		client.once('close', () => clients.delete(client));
		client
			.on('error', () => {
				clients.delete(client);
			})
			.on('authentication', (context) => {
				if (
					context.method === 'password' &&
					context.username === 'smoke' &&
					context.password === 'smoke-password'
				) {
					context.accept();
					return;
				}
				context.reject();
			})
			.on('ready', () => {
				client.on('session', (accept) => {
					const session = accept();
					session.on('pty', (acceptPty) => acceptPty?.());
					session.on('shell', (acceptShell) => {
						const stream = acceptShell();
						stream.write('ssh-ready\n');
						stream.on('data', (chunk) => {
							if (chunk.includes(Buffer.from('smoke-shell'))) {
								stream.write('ssh-echo:smoke-shell\n');
								stream.exit(0);
								stream.end();
							}
						});
					});
					session.on('sftp', (acceptSftp) => installSftpSmokeServer(acceptSftp()));
				});
			});
	});
	server.closeAllClients = () => {
		for (const client of clients) {
			destroySshClient(client);
		}
		clients.clear();
	};
	return server;
}

function installSftpSmokeServer(sftp) {
	const openDirectories = new Map();
	let nextHandle = 1;

	sftp
		.on('REALPATH', (requestId) => {
			sftp.name(requestId, [
				{
					filename: '/',
					longname: 'drwxr-xr-x 1 smoke smoke 0 Jan 1 1970 /',
					attrs: directoryAttrs()
				}
			]);
		})
		.on('OPENDIR', (requestId, path) => {
			if (path !== '/') {
				sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
				return;
			}

			const handle = Buffer.alloc(4);
			const id = nextHandle++;
			handle.writeUInt32BE(id, 0);
			openDirectories.set(id, { sent: false });
			sftp.handle(requestId, handle);
		})
		.on('READDIR', (requestId, handle) => {
			const directory = getSftpHandle(openDirectories, handle);
			if (!directory) {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}

			if (directory.sent) {
				sftp.status(requestId, STATUS_CODE.EOF);
				return;
			}

			directory.sent = true;
			sftp.name(requestId, [
				{
					filename: 'smoke.txt',
					longname: '-rw-r--r-- 1 smoke smoke 5 Jan 1 1970 smoke.txt',
					attrs: fileAttrs(5)
				}
			]);
		})
		.on('CLOSE', (requestId, handle) => {
			const id = handle.length === 4 ? handle.readUInt32BE(0) : null;
			if (id === null || !openDirectories.delete(id)) {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}

			sftp.status(requestId, STATUS_CODE.OK);
		});
}

function connectSshClient(client, port) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			client.off('ready', onReady);
			client.off('error', onError);
		};
		const onReady = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};

		client.once('ready', onReady);
		client.once('error', onError);
		client.connect({
			host: '127.0.0.1',
			port,
			username: 'smoke',
			password: 'smoke-password',
			hostVerifier: () => true,
			readyTimeout: probeTimeoutMs
		});
	});
}

function smokeSshShell(client) {
	return new Promise((resolve, reject) => {
		client.shell((error, stream) => {
			if (error) {
				reject(error);
				return;
			}

			let output = '';
			stream.setEncoding('utf8');
			stream.on('data', (chunk) => {
				output += chunk;
				if (output.includes('ssh-ready')) stream.write('smoke-shell\n');
				if (output.includes('ssh-echo:smoke-shell')) resolve();
			});
			stream.once('error', reject);
			stream.once('close', () => {
				if (!output.includes('ssh-echo:smoke-shell')) {
					reject(new Error(`SSH shell closed before echoing probe:\n${output}`));
				}
			});
		});
	});
}

function smokeSftpList(client) {
	return new Promise((resolve, reject) => {
		client.sftp((error, sftp) => {
			if (error) {
				reject(error);
				return;
			}

			sftp.readdir('/', (readError, entries) => {
				sftp.end();
				if (readError) {
					reject(readError);
					return;
				}

				const names = entries.map((entry) => entry.filename);
				if (!names.includes('smoke.txt')) {
					reject(new Error(`SFTP listing missed smoke.txt; saw ${names.join(', ') || '<empty>'}`));
					return;
				}

				resolve();
			});
		});
	});
}

function negotiateTelnet(chunk, size) {
	const data = [];
	const response = [];

	for (let index = 0; index < chunk.length; ) {
		if (chunk[index] !== IAC) {
			data.push(chunk[index]);
			index += 1;
			continue;
		}

		if (chunk[index + 1] === DO && chunk[index + 2] === NAWS) {
			response.push(IAC, WILL, NAWS, ...encodeTelnetNaws(size));
			index += 3;
			continue;
		}

		index += 2;
	}

	return { data: Buffer.from(data), response: Buffer.from(response) };
}

function encodeTelnetNaws({ cols, rows }) {
	return [IAC, SB, NAWS, ...uint16(cols), ...uint16(rows), IAC, SE];
}

function uint16(value) {
	return [(value >> 8) & 0xff, value & 0xff];
}

function getSftpHandle(handles, handle) {
	if (handle.length !== 4) return null;
	return handles.get(handle.readUInt32BE(0)) ?? null;
}

function directoryAttrs() {
	return {
		mode: fsConstants.S_IFDIR | 0o755,
		uid: 0,
		gid: 0,
		size: 0,
		atime: 0,
		mtime: 0
	};
}

function fileAttrs(size) {
	return {
		mode: fsConstants.S_IFREG | 0o644,
		uid: 0,
		gid: 0,
		size,
		atime: 0,
		mtime: 0
	};
}

function listen(server) {
	server.listen(0, '127.0.0.1');
	return once(server, 'listening');
}

function closeServer(server) {
	return new Promise((resolve) => {
		server.closeAllClients?.();
		server.closeAllConnections?.();
		if (!server.listening) {
			resolve();
			return;
		}

		server.close(() => resolve());
	});
}

async function withTimeout(promise, label, cleanup) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${probeTimeoutMs}ms`)),
			probeTimeoutMs
		);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		await runCleanup(cleanup);
		clearTimeout(timer);
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function bufferIncludes(buffer, needle) {
	return buffer.indexOf(needle) !== -1;
}

async function runCleanup(cleanup) {
	for (const callback of cleanup.toReversed()) {
		try {
			await callback();
		} catch {
			// Best-effort cleanup for smoke failures.
		}
	}
}

function destroySocket(socket) {
	socket?.destroy();
}

function destroySshClient(client) {
	if (!client) return;
	if (typeof client.destroy === 'function') {
		client.destroy();
		return;
	}
	client.end?.();
}
