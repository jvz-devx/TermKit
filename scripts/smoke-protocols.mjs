import { createRequire } from 'node:module';
import { constants as fsConstants } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
const pendingSocketReads = new WeakMap();

try {
	await runSmoke('telnet loopback negotiation', smokeTelnet);
	await runSmoke('vnc loopback rfb banner', smokeVnc);
	await runSmoke('vnc loopback no-auth handshakes', smokeVncNoAuthVersions);
	await runSmoke('ssh shell and sftp loopback', smokeSshAndSftp);
	if (process.env.TERMIXKIT_SMOKE_SSH_HOST) {
		await runSmoke('real SSH target exec and SFTP', smokeRealSshTarget);
	} else {
		skipSmoke('real SSH target exec and SFTP', 'missing TERMIXKIT_SMOKE_SSH_HOST');
	}
	if (process.env.TERMIXKIT_SMOKE_VNC_HOST) {
		await runSmoke('real VNC target framebuffer handshake', smokeRealVncTarget);
	} else {
		skipSmoke(
			'real VNC target framebuffer handshake',
			'missing TERMIXKIT_SMOKE_VNC_HOST; local smoke verifies the RFB TCP banner only'
		);
	}

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
	return connectSshClientWithConfig(client, {
		host: '127.0.0.1',
		port,
		username: 'smoke',
		password: 'smoke-password',
		hostVerifier: () => true
	});
}

function connectSshClientWithConfig(client, config) {
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
		client.connect({ ...config, readyTimeout: probeTimeoutMs });
	});
}

async function smokeRealSshTarget({ cleanup }) {
	const config = await realSshConfig();
	const client = new Client();
	cleanup.push(() => destroySshClient(client));

	await connectSshClientWithConfig(client, config);
	await smokeSshExec(
		client,
		process.env.TERMIXKIT_SMOKE_SSH_COMMAND ?? 'printf termixkit-ssh-smoke'
	);
	if (process.env.TERMIXKIT_SMOKE_SSH_SKIP_SFTP !== '1') {
		await smokeSftpReaddir(client, process.env.TERMIXKIT_SMOKE_SSH_SFTP_PATH ?? '.');
	}
}

async function realSshConfig() {
	const host = requiredEnv('TERMIXKIT_SMOKE_SSH_HOST');
	const username = requiredEnv('TERMIXKIT_SMOKE_SSH_USERNAME');
	const port = readPort(process.env.TERMIXKIT_SMOKE_SSH_PORT ?? '22', 'TERMIXKIT_SMOKE_SSH_PORT');
	const privateKey = await readOptionalFile(process.env.TERMIXKIT_SMOKE_SSH_PRIVATE_KEY_PATH);
	const password = process.env.TERMIXKIT_SMOKE_SSH_PASSWORD;
	const expectedHostHash = normalizeSha256Fingerprint(
		requiredEnv('TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256')
	);

	assert(
		Boolean(password || privateKey),
		'Set TERMIXKIT_SMOKE_SSH_PASSWORD or TERMIXKIT_SMOKE_SSH_PRIVATE_KEY_PATH for real SSH smoke.'
	);

	return {
		host,
		port,
		username,
		hostHash: 'sha256',
		hostVerifier: (hostHash) => hostHash.toLowerCase() === expectedHostHash,
		...(password ? { password } : {}),
		...(privateKey ? { privateKey } : {}),
		...(process.env.TERMIXKIT_SMOKE_SSH_PRIVATE_KEY_PASSPHRASE
			? { passphrase: process.env.TERMIXKIT_SMOKE_SSH_PRIVATE_KEY_PASSPHRASE }
			: {})
	};
}

function smokeSshExec(client, command) {
	return new Promise((resolve, reject) => {
		client.exec(command, (error, stream) => {
			if (error) {
				reject(error);
				return;
			}

			let output = '';
			let stderr = '';
			stream.setEncoding('utf8');
			stream.stderr.setEncoding('utf8');
			stream.on('data', (chunk) => {
				output += chunk;
			});
			stream.stderr.on('data', (chunk) => {
				stderr += chunk;
			});
			stream.once('error', reject);
			stream.once('close', (code) => {
				if (code !== 0) {
					reject(new Error(`real SSH command exited ${code}: ${stderr || output}`));
					return;
				}
				if (!output.trim()) {
					reject(new Error('real SSH command produced no output.'));
					return;
				}
				resolve();
			});
		});
	});
}

function smokeSftpReaddir(client, path) {
	return new Promise((resolve, reject) => {
		client.sftp((error, sftp) => {
			if (error) {
				reject(error);
				return;
			}

			sftp.readdir(path, (readError, entries) => {
				sftp.end();
				if (readError) {
					reject(readError);
					return;
				}
				if (!Array.isArray(entries)) {
					reject(new Error('real SFTP readdir did not return entries.'));
					return;
				}
				resolve();
			});
		});
	});
}

async function smokeRealVncTarget({ cleanup }) {
	const host = requiredEnv('TERMIXKIT_SMOKE_VNC_HOST');
	const port = readPort(process.env.TERMIXKIT_SMOKE_VNC_PORT ?? '5900', 'TERMIXKIT_SMOKE_VNC_PORT');
	await smokeVncNoAuthHandshake({ host, port, cleanup });
}

async function smokeVncNoAuthVersions({ cleanup }) {
	for (const version of ['RFB 003.003\n', 'RFB 003.007\n', 'RFB 003.008\n']) {
		await smokeVncNoAuthVersion(version, cleanup);
	}
}

async function smokeVncNoAuthVersion(version, cleanup) {
	const server = createVncNoAuthFixture(version);
	cleanup.push(() => closeServer(server));
	await listen(server);
	await smokeVncNoAuthHandshake({
		host: '127.0.0.1',
		port: server.address().port,
		cleanup
	});
	await closeServer(server);
}

function createVncNoAuthFixture(version) {
	const sockets = new Set();
	const server = createServer(async (socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
		try {
			const banner = Buffer.from(version);
			socket.write(banner);
			const clientBanner = await readExactly(socket, banner.length);
			if (!clientBanner.equals(banner)) {
				socket.destroy(new Error('client used the wrong RFB version'));
				return;
			}

			if (version.startsWith('RFB 003.003')) {
				socket.write(Buffer.from([0, 0, 0, 1]));
			} else {
				socket.write(Buffer.from([1, 1]));
				const selectedType = await readExactly(socket, 1);
				if (selectedType[0] !== 1) {
					socket.destroy(new Error('client selected the wrong VNC security type'));
					return;
				}
				if (version.startsWith('RFB 003.008')) socket.write(Buffer.from([0, 0, 0, 0]));
			}

			await readExactly(socket, 1);
			socket.end(vncServerInit());
		} catch {
			socket.destroy();
		}
	});
	server.closeAllClients = () => {
		for (const socket of sockets) destroySocket(socket);
		sockets.clear();
	};
	return server;
}

function vncServerInit() {
	const name = Buffer.from('TermixKit smoke VNC');
	const serverInit = Buffer.alloc(24);
	serverInit.writeUInt16BE(800, 0);
	serverInit.writeUInt16BE(600, 2);
	serverInit[4] = 32;
	serverInit[5] = 24;
	serverInit[6] = 0;
	serverInit[7] = 1;
	serverInit.writeUInt16BE(255, 8);
	serverInit.writeUInt16BE(255, 10);
	serverInit.writeUInt16BE(255, 12);
	serverInit[14] = 16;
	serverInit[15] = 8;
	serverInit[16] = 0;
	serverInit.writeUInt32BE(name.length, 20);
	return Buffer.concat([serverInit, name]);
}

async function smokeVncNoAuthHandshake({ host, port, cleanup }) {
	const socket = connect(port, host);
	cleanup.push(() => destroySocket(socket));

	try {
		await connectSocket(socket);
		const banner = await readExactly(socket, 12);
		assert(/^RFB 00[3-9]\.00[0-9]\n$/.test(banner.toString('ascii')), 'real VNC banner mismatch');
		socket.write(banner);

		const security = await readVncSecurityTypes(socket, banner);
		assert(
			security.types.includes(1),
			`real VNC target did not offer no-auth security type; saw ${security.types.join(', ') || '<none>'}`
		);
		if (security.needsSelection) socket.write(Buffer.from([1]));

		if (security.needsSecurityResult) {
			const securityResult = await readExactly(socket, 4);
			assert(securityResult.readUInt32BE(0) === 0, 'real VNC no-auth security handshake failed');
		}
		socket.write(Buffer.from([1]));

		const serverInit = await readExactly(socket, 24);
		const width = serverInit.readUInt16BE(0);
		const height = serverInit.readUInt16BE(2);
		assert(width > 0 && height > 0, 'real VNC framebuffer dimensions were empty');
	} finally {
		destroySocket(socket);
	}
}

async function readVncSecurityTypes(socket, banner) {
	const version = banner.toString('ascii');
	if (version.startsWith('RFB 003.003')) {
		const securityType = (await readExactly(socket, 4)).readUInt32BE(0);
		return {
			types: securityType === 0 ? [] : [securityType],
			needsSelection: false,
			needsSecurityResult: false
		};
	}

	const count = (await readExactly(socket, 1))[0];
	if (count === 0) {
		const reasonLength = (await readExactly(socket, 4)).readUInt32BE(0);
		const reason = (await readExactly(socket, reasonLength)).toString('utf8');
		throw new Error(`real VNC target rejected security negotiation: ${reason}`);
	}
	return {
		types: [...(await readExactly(socket, count))],
		needsSelection: true,
		needsSecurityResult: version.startsWith('RFB 003.008')
	};
}

function connectSocket(socket) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			socket.off('connect', onConnect);
			socket.off('error', onError);
		};
		const onConnect = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};

		socket.once('connect', onConnect);
		socket.once('error', onError);
	});
}

function readExactly(socket, length) {
	return new Promise((resolve, reject) => {
		let buffer = pendingSocketReads.get(socket) ?? Buffer.alloc(0);
		pendingSocketReads.delete(socket);
		const cleanup = () => {
			socket.off('data', onData);
			socket.off('error', onError);
			socket.off('close', onClose);
		};
		const resolveIfReady = () => {
			if (buffer.length < length) return false;
			cleanup();
			const head = buffer.subarray(0, length);
			const tail = buffer.subarray(length);
			if (tail.length > 0) pendingSocketReads.set(socket, tail);
			resolve(head);
			return true;
		};
		const onData = (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			resolveIfReady();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		const onClose = () => {
			cleanup();
			reject(new Error(`socket closed before reading ${length} bytes`));
		};

		if (!resolveIfReady()) {
			socket.on('data', onData);
			socket.once('error', onError);
			socket.once('close', onClose);
		}
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

function requiredEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function readPort(value, name) {
	if (!/^\d+$/.test(value)) {
		throw new Error(`${name} must be an integer from 1 to 65535.`);
	}
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${name} must be an integer from 1 to 65535.`);
	}
	return port;
}

async function readOptionalFile(path) {
	if (!path?.trim()) return undefined;
	return readFile(path, 'utf8');
}

function normalizeSha256Fingerprint(value) {
	const trimmed = value.trim();
	if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

	const base64 = trimmed.startsWith('SHA256:') ? trimmed.slice('SHA256:'.length) : trimmed;
	try {
		const digest = Buffer.from(base64, 'base64');
		if (digest.length === 32) return digest.toString('hex');
	} catch {
		// Fall through to the explicit validation error below.
	}

	throw new Error(
		'TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256 must be a SHA256:<base64> OpenSSH fingerprint or 64-character hex SHA256 digest.'
	);
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
