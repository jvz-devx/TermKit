import assert from 'node:assert/strict';
import { once } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import posixPath from 'node:path/posix';
import { createServer } from 'node:net';
import { TLSSocket, createSecureContext, createServer as createTlsServer } from 'node:tls';
import { errorText, listen } from './smoke-app-runtime.mjs';

export function createFileFixtureHelpers(statusCode) {
	const STATUS_CODE = statusCode;
	function createFtpFixtureServer({ label, files, tls = null }) {
		const directories = new Set(['/']);
		const sockets = new Set();
		const dataServers = new Set();
		const filesystem = { files, directories };
		const state = {
			authTlsCount: 0,
			protectedTransferCount: 0
		};
		const server = createServer((socket) => {
			sockets.add(socket);
			socket.once('close', () => sockets.delete(socket));
			installFtpControlSession(socket, filesystem, { label, tls, state, dataServers, sockets });
		});

		server.closeAllClients = () => {
			for (const socket of sockets) socket.destroy();
			sockets.clear();
			for (const dataServer of dataServers) dataServer.close();
			dataServers.clear();
		};

		return { server, state };
	}

	function installFtpControlSession(initialSocket, filesystem, fixture) {
		let socket = initialSocket;
		let buffer = '';
		let currentDirectory = '/';
		let pendingRename = null;
		let pendingData = null;
		let protectedData = false;
		let currentUser = null;

		const onData = (chunk) => {
			buffer += chunk.toString('utf8');
			let newline;
			while ((newline = buffer.indexOf('\n')) !== -1) {
				const rawLine = buffer.slice(0, newline).replace(/\r$/, '');
				buffer = buffer.slice(newline + 1);
				void handleFtpCommand(rawLine).catch((error) => {
					sendFtp(socket, 451, errorText(error));
				});
			}
		};

		const attach = (nextSocket) => {
			socket = nextSocket;
			fixture.sockets.add(socket);
			socket.setEncoding('utf8');
			socket.once('close', () => fixture.sockets.delete(socket));
			socket.on('error', () => fixture.sockets.delete(socket));
			socket.on('data', onData);
		};

		attach(socket);
		sendFtp(socket, 220, `TermKit ${fixture.label} fixture ready`);

		async function handleFtpCommand(rawLine) {
			if (!rawLine.trim()) return;
			const [rawCommand, ...rest] = rawLine.split(' ');
			const command = rawCommand.toUpperCase();
			const argument = rest.join(' ');

			switch (command) {
				case 'AUTH':
					if (!fixture.tls || argument.toUpperCase() !== 'TLS') {
						sendFtp(socket, 502, 'AUTH mechanism not supported');
						return;
					}
					fixture.state.authTlsCount += 1;
					socket.removeListener('data', onData);
					sendFtp(socket, 234, 'AUTH TLS successful');
					attach(
						new TLSSocket(socket, {
							isServer: true,
							secureContext: createSecureContext({ key: fixture.tls.key, cert: fixture.tls.cert })
						})
					);
					return;
				case 'USER':
					currentUser = argument;
					sendFtp(socket, 331, 'Password required');
					return;
				case 'PASS':
					if (currentUser === 'ftp-smoke' && argument === 'ftp-smoke-password') {
						sendFtp(socket, 230, 'Login successful');
						return;
					}
					sendFtp(socket, 530, 'Login incorrect');
					return;
				case 'FEAT':
					sendFtpRaw(socket, '211-Features\r\n UTF8\r\n211 End\r\n');
					return;
				case 'OPTS':
				case 'TYPE':
				case 'STRU':
				case 'PBSZ':
					sendFtp(socket, 200, 'OK');
					return;
				case 'PROT':
					protectedData = argument.toUpperCase() === 'P';
					sendFtp(socket, 200, 'Protection set');
					return;
				case 'PWD':
					sendFtp(socket, 257, `"${currentDirectory}" is current directory`);
					return;
				case 'CWD': {
					const path = ftpPath(argument, currentDirectory);
					if (!filesystem.directories.has(path)) {
						sendFtp(socket, 550, 'Directory not found');
						return;
					}
					currentDirectory = path;
					sendFtp(socket, 250, 'Directory changed');
					return;
				}
				case 'CDUP':
					currentDirectory = currentDirectory === '/' ? '/' : posixPath.dirname(currentDirectory);
					sendFtp(socket, 250, 'Directory changed');
					return;
				case 'EPSV':
					pendingData = await prepareFtpDataConnection(fixture, protectedData);
					sendFtp(socket, 229, `Entering Extended Passive Mode (|||${pendingData.port}|)`);
					return;
				case 'PASV':
					pendingData = await prepareFtpDataConnection(fixture, protectedData);
					sendFtp(
						socket,
						227,
						`Entering Passive Mode (127,0,0,1,${pendingData.p1},${pendingData.p2})`
					);
					return;
				case 'LIST':
				case 'MLSD':
					await sendFtpDirectoryList(
						socket,
						pendingData,
						filesystem,
						ftpListPath(argument, currentDirectory)
					);
					pendingData = null;
					return;
				case 'RETR':
					await sendFtpFile(socket, pendingData, filesystem, ftpPath(argument, currentDirectory));
					pendingData = null;
					return;
				case 'STOR':
					await receiveFtpFile(
						socket,
						pendingData,
						filesystem,
						ftpPath(argument, currentDirectory)
					);
					pendingData = null;
					return;
				case 'MKD':
					createFtpDirectoryPath(filesystem, ftpPath(argument, currentDirectory));
					sendFtp(socket, 257, 'Directory created');
					return;
				case 'RNFR': {
					const from = ftpPath(argument, currentDirectory);
					if (!filesystem.files.has(from) && !filesystem.directories.has(from)) {
						sendFtp(socket, 550, 'Path not found');
						return;
					}
					pendingRename = from;
					sendFtp(socket, 350, 'Ready for RNTO');
					return;
				}
				case 'RNTO':
					if (!pendingRename) {
						sendFtp(socket, 503, 'RNFR required first');
						return;
					}
					renameFtpFixturePath(filesystem, pendingRename, ftpPath(argument, currentDirectory));
					pendingRename = null;
					sendFtp(socket, 250, 'Rename successful');
					return;
				case 'DELE': {
					const path = ftpPath(argument, currentDirectory);
					if (!filesystem.files.delete(path)) {
						sendFtp(socket, 550, 'File not found');
						return;
					}
					sendFtp(socket, 250, 'Deleted');
					return;
				}
				case 'RMD': {
					const path = ftpPath(argument, currentDirectory);
					if (
						path === '/' ||
						!filesystem.directories.has(path) ||
						listFtpFixtureEntries(filesystem, path).length
					) {
						sendFtp(socket, 550, 'Directory unavailable');
						return;
					}
					filesystem.directories.delete(path);
					sendFtp(socket, 250, 'Directory removed');
					return;
				}
				case 'QUIT':
					sendFtp(socket, 221, 'Bye');
					socket.end();
					return;
				default:
					sendFtp(socket, 502, `Unsupported command ${command}`);
			}
		}
	}

	async function prepareFtpDataConnection(fixture, protectedData) {
		const serverFactory =
			protectedData && fixture.tls
				? (handler) => createTlsServer({ key: fixture.tls.key, cert: fixture.tls.cert }, handler)
				: (handler) => createServer(handler);

		let resolveSocket;
		const socketPromise = new Promise((resolve) => {
			resolveSocket = resolve;
		});
		const dataServer = serverFactory((socket) => {
			fixture.sockets.add(socket);
			socket.once('close', () => fixture.sockets.delete(socket));
			if (protectedData && fixture.tls) fixture.state.protectedTransferCount += 1;
			resolveSocket(socket);
			dataServer.close();
			fixture.dataServers.delete(dataServer);
		});
		fixture.dataServers.add(dataServer);
		await listen(dataServer);
		const address = dataServer.address();
		assert(address && typeof address !== 'string', 'FTP data server did not bind a TCP port');
		return {
			port: address.port,
			p1: Math.floor(address.port / 256),
			p2: address.port % 256,
			socket: socketPromise
		};
	}

	async function sendFtpDirectoryList(controlSocket, pendingData, filesystem, path) {
		const dataSocket = await requireFtpDataSocket(pendingData);
		const entries = listFtpFixtureEntries(filesystem, path);
		sendFtp(controlSocket, 150, 'Opening data connection');
		dataSocket.end(entries.map(formatFtpListEntry).join(''));
		await once(dataSocket, 'close').catch(() => {});
		sendFtp(controlSocket, 226, 'Transfer complete');
	}

	async function sendFtpFile(controlSocket, pendingData, filesystem, path) {
		const data = filesystem.files.get(path);
		if (!data) {
			sendFtp(controlSocket, 550, 'File not found');
			return;
		}
		const dataSocket = await requireFtpDataSocket(pendingData);
		sendFtp(controlSocket, 150, 'Opening data connection');
		dataSocket.end(data);
		await once(dataSocket, 'close').catch(() => {});
		sendFtp(controlSocket, 226, 'Transfer complete');
	}

	async function receiveFtpFile(controlSocket, pendingData, filesystem, path) {
		if (!filesystem.directories.has(posixPath.dirname(path))) {
			sendFtp(controlSocket, 550, 'Parent directory not found');
			return;
		}
		const dataSocket = await requireFtpDataSocket(pendingData);
		const chunks = [];
		sendFtp(controlSocket, 150, 'Opening data connection');
		dataSocket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
		await once(dataSocket, 'end').catch(() => {});
		filesystem.files.set(path, Buffer.concat(chunks));
		sendFtp(controlSocket, 226, 'Transfer complete');
	}

	async function requireFtpDataSocket(pendingData) {
		if (!pendingData) throw new Error('FTP data connection was not prepared');
		return pendingData.socket;
	}

	function ftpPath(value, currentDirectory) {
		const raw = typeof value === 'string' && value.trim() ? value.trim() : currentDirectory;
		const joined = raw.startsWith('/') ? raw : posixPath.join(currentDirectory, raw);
		const normalized = normalizeRemotePath(joined);
		if (normalized.split('/').includes('..')) throw new Error('FTP path traversal is not allowed');
		return normalized;
	}

	function ftpListPath(value, currentDirectory) {
		const cleaned = value.replace(/(^|\s)-[A-Za-z]+\s*/g, '').trim();
		return ftpPath(cleaned || currentDirectory, currentDirectory);
	}

	function createFtpDirectoryPath(filesystem, path) {
		const segments = path.split('/').filter(Boolean);
		let current = '/';
		for (const segment of segments) {
			current = normalizeRemotePath(posixPath.join(current, segment));
			filesystem.directories.add(current);
		}
	}

	function renameFtpFixturePath(filesystem, source, target) {
		if (!filesystem.directories.has(posixPath.dirname(target))) {
			throw new Error('FTP rename target parent is missing');
		}
		if (filesystem.files.has(source)) {
			filesystem.files.set(target, filesystem.files.get(source));
			filesystem.files.delete(source);
			return;
		}
		if (source !== '/' && filesystem.directories.has(source)) {
			filesystem.directories.add(target);
			filesystem.directories.delete(source);
			for (const [path, data] of [...filesystem.files.entries()]) {
				if (path.startsWith(`${source}/`)) {
					filesystem.files.set(`${target}${path.slice(source.length)}`, data);
					filesystem.files.delete(path);
				}
			}
			for (const path of [...filesystem.directories]) {
				if (path.startsWith(`${source}/`)) {
					filesystem.directories.add(`${target}${path.slice(source.length)}`);
					filesystem.directories.delete(path);
				}
			}
		}
	}

	function listFtpFixtureEntries({ files, directories }, directory) {
		const entries = [];
		for (const path of directories) {
			if (path === directory || posixPath.dirname(path) !== directory) continue;
			entries.push({ name: posixPath.basename(path), type: 'directory', size: 0 });
		}
		for (const [path, data] of files) {
			if (posixPath.dirname(path) !== directory) continue;
			entries.push({ name: posixPath.basename(path), type: 'file', size: data.length });
		}
		return entries.sort((left, right) => left.name.localeCompare(right.name));
	}

	function formatFtpListEntry(entry) {
		const mode = entry.type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--';
		return `${mode} 1 smoke smoke ${entry.size} Jan 01 2026 ${entry.name}\r\n`;
	}

	function sendFtp(socket, code, message) {
		sendFtpRaw(socket, `${code} ${message}\r\n`);
	}

	function sendFtpRaw(socket, value) {
		socket.write(value);
	}

	function installSftpFixtureServer(sftp, filesystem) {
		const { files, directories } = filesystem;
		const handles = new Map();
		let nextHandle = 1;

		sftp
			.on('REALPATH', (requestId, path = '/') => {
				const resolved = normalizeRemotePath(path);
				sftp.name(requestId, [
					{
						filename: resolved,
						longname: longname(resolved, directoryAttrs()),
						attrs: resolved === '/' ? directoryAttrs() : fileAttrs(files.get(resolved)?.length ?? 0)
					}
				]);
			})
			.on('STAT', (requestId, path) => sendAttrs(sftp, requestId, filesystem, path))
			.on('LSTAT', (requestId, path) => sendAttrs(sftp, requestId, filesystem, path))
			.on('FSTAT', (requestId, handle) => {
				const entry = getHandle(handles, handle);
				if (!entry) {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				sftp.attrs(requestId, entry.type === 'dir' ? directoryAttrs() : fileAttrs(entry.size()));
			})
			.on('OPENDIR', (requestId, path) => {
				const remotePath = normalizeRemotePath(path);
				if (!directories.has(remotePath)) {
					sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
					return;
				}
				const handle = createHandle(nextHandle++);
				handles.set(handle.readUInt32BE(0), { type: 'dir', path: remotePath, sent: false });
				sftp.handle(requestId, handle);
			})
			.on('READDIR', (requestId, handle) => {
				const entry = getHandle(handles, handle);
				if (!entry || entry.type !== 'dir') {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				if (entry.sent) {
					sftp.status(requestId, STATUS_CODE.EOF);
					return;
				}
				entry.sent = true;
				sftp.name(requestId, listDirectoryEntries(filesystem, entry.path));
			})
			.on('OPEN', (requestId, path, flags) => {
				const remotePath = normalizeRemotePath(path);
				if (remotePath === '/') {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				if (!directories.has(posixPath.dirname(remotePath))) {
					sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
					return;
				}
				if (!files.has(remotePath) && !isWritableOpen(flags)) {
					sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
					return;
				}
				if (isWritableOpen(flags)) files.set(remotePath, Buffer.alloc(0));

				const handle = createHandle(nextHandle++);
				handles.set(handle.readUInt32BE(0), {
					type: 'file',
					path: remotePath,
					size: () => files.get(remotePath)?.length ?? 0
				});
				sftp.handle(requestId, handle);
			})
			.on('READ', (requestId, handle, offset, length) => {
				const entry = getHandle(handles, handle);
				if (!entry || entry.type !== 'file') {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				const data = files.get(entry.path) ?? Buffer.alloc(0);
				if (offset >= data.length) {
					sftp.status(requestId, STATUS_CODE.EOF);
					return;
				}
				sftp.data(requestId, data.subarray(offset, Math.min(offset + length, data.length)));
			})
			.on('WRITE', (requestId, handle, offset, data) => {
				const entry = getHandle(handles, handle);
				if (!entry || entry.type !== 'file') {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				const current = files.get(entry.path) ?? Buffer.alloc(0);
				const next = Buffer.alloc(Math.max(current.length, offset + data.length));
				current.copy(next);
				data.copy(next, offset);
				files.set(entry.path, next);
				sftp.status(requestId, STATUS_CODE.OK);
			})
			.on('MKDIR', (requestId, path) => {
				const remotePath = normalizeRemotePath(path);
				if (remotePath === '/' || files.has(remotePath) || directories.has(remotePath)) {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				if (!directories.has(posixPath.dirname(remotePath))) {
					sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
					return;
				}
				directories.add(remotePath);
				sftp.status(requestId, STATUS_CODE.OK);
			})
			.on('REMOVE', (requestId, path) => {
				const remotePath = normalizeRemotePath(path);
				if (!files.delete(remotePath)) {
					sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
					return;
				}
				sftp.status(requestId, STATUS_CODE.OK);
			})
			.on('RMDIR', (requestId, path) => {
				const remotePath = normalizeRemotePath(path);
				if (remotePath === '/' || !directories.has(remotePath)) {
					sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
					return;
				}
				if (listDirectoryEntries(filesystem, remotePath).length > 0) {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				directories.delete(remotePath);
				sftp.status(requestId, STATUS_CODE.OK);
			})
			.on('RENAME', (requestId, from, to) => {
				const source = normalizeRemotePath(from);
				const target = normalizeRemotePath(to);
				if (!directories.has(posixPath.dirname(target))) {
					sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
					return;
				}
				if (files.has(source)) {
					files.set(target, files.get(source));
					files.delete(source);
					sftp.status(requestId, STATUS_CODE.OK);
					return;
				}
				if (source !== '/' && directories.has(source)) {
					directories.add(target);
					directories.delete(source);
					for (const [path, data] of [...files.entries()]) {
						if (path.startsWith(`${source}/`)) {
							files.set(`${target}${path.slice(source.length)}`, data);
							files.delete(path);
						}
					}
					for (const path of [...directories]) {
						if (path.startsWith(`${source}/`)) {
							directories.add(`${target}${path.slice(source.length)}`);
							directories.delete(path);
						}
					}
					sftp.status(requestId, STATUS_CODE.OK);
					return;
				}
				sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
			})
			.on('CLOSE', (requestId, handle) => {
				const id = handle.length === 4 ? handle.readUInt32BE(0) : null;
				if (id === null || !handles.delete(id)) {
					sftp.status(requestId, STATUS_CODE.FAILURE);
					return;
				}
				sftp.status(requestId, STATUS_CODE.OK);
			});
	}

	function sendAttrs(sftp, requestId, { files, directories }, path) {
		const remotePath = normalizeRemotePath(path);
		if (directories.has(remotePath)) {
			sftp.attrs(requestId, directoryAttrs());
			return;
		}
		const data = files.get(remotePath);
		if (!data) {
			sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
			return;
		}
		sftp.attrs(requestId, fileAttrs(data.length));
	}

	function listDirectoryEntries({ files, directories }, directory) {
		const entries = [];
		for (const path of directories) {
			if (path === directory || posixPath.dirname(path) !== directory) continue;
			const attrs = directoryAttrs();
			const name = posixPath.basename(path);
			entries.push({ filename: name, longname: longname(name, attrs), attrs });
		}
		for (const [path, data] of files) {
			if (posixPath.dirname(path) !== directory) continue;
			const attrs = fileAttrs(data.length);
			const name = posixPath.basename(path);
			entries.push({ filename: name, longname: longname(name, attrs), attrs });
		}
		return entries.sort((left, right) => left.filename.localeCompare(right.filename));
	}
	function normalizeRemotePath(path) {
		const value = typeof path === 'string' && path.trim() ? path.trim() : '/';
		const normalized = posixPath.normalize(value.startsWith('/') ? value : `/${value}`);
		return normalized === '.' ? '/' : normalized;
	}

	function createHandle(id) {
		const handle = Buffer.alloc(4);
		handle.writeUInt32BE(id, 0);
		return handle;
	}

	function getHandle(handles, handle) {
		if (handle.length !== 4) return null;
		return handles.get(handle.readUInt32BE(0)) ?? null;
	}

	function isWritableOpen(flags) {
		return (flags & 0x00000002) !== 0 || (flags & 0x00000008) !== 0 || (flags & 0x00000010) !== 0;
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

	function longname(name, attrs) {
		const kind = (attrs.mode & fsConstants.S_IFDIR) === fsConstants.S_IFDIR ? 'd' : '-';
		return `${kind}rw-r--r-- 1 smoke smoke ${attrs.size} Jan 1 1970 ${name}`;
	}

	return {
		createFtpFixtureServer,
		installSftpFixtureServer
	};
}
