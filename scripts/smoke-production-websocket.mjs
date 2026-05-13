import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { resolve } from 'node:path';

const serverEntry = resolve('build/server.js');

if (!existsSync(serverEntry)) {
	console.error('build/server.js is missing. Run npm run build before this smoke test.');
	process.exit(1);
}

const port = await findAvailablePort();
const child = spawn(process.execPath, [serverEntry], {
	env: { ...process.env, HOST: '127.0.0.1', NODE_ENV: 'production', PORT: String(port) },
	stdio: ['ignore', 'pipe', 'pipe']
});
const logs = { stdout: '', stderr: '' };

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
	logs.stdout += chunk;
});
child.stderr.on('data', (chunk) => {
	logs.stderr += chunk;
});

try {
	await waitForPort(port, child, logs);
	const response = await rawWebSocketUpgrade(port, '/ws/ssh/bad-ticket');

	if (!response.startsWith('HTTP/1.1 401 Invalid or expired session ticket')) {
		throw new Error(`Expected websocket auth rejection, got:\n${response}`);
	}

	console.log('production websocket smoke: /ws/ssh/bad-ticket returned 401 auth rejection');
} finally {
	await stopChild(child);
}

function findAvailablePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();

		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Could not allocate TCP port')));
				return;
			}

			server.close((error) => (error ? reject(error) : resolvePort(address.port)));
		});
	});
}

function waitForPort(port, child, logs) {
	const deadline = Date.now() + 5000;

	return new Promise((resolveReady, reject) => {
		const failIfExited = (code, signal) => {
			reject(
				new Error(
					`Production server exited before accepting connections: ${code ?? signal}\n${formatLogs(logs)}`
				)
			);
		};
		child.once('exit', failIfExited);

		const poll = () => {
			const socket = connect(port, '127.0.0.1');
			socket.once('connect', () => {
				child.off('exit', failIfExited);
				socket.end();
				resolveReady();
			});
			socket.once('error', () => {
				socket.destroy();
				if (Date.now() >= deadline) {
					child.off('exit', failIfExited);
					reject(new Error(`Timed out waiting for production server\n${formatLogs(logs)}`));
					return;
				}

				setTimeout(poll, 100);
			});
		};

		poll();
	});
}

function rawWebSocketUpgrade(port, path) {
	return new Promise((resolveResponse, reject) => {
		const socket = connect(port, '127.0.0.1');
		const key = randomBytes(16).toString('base64');
		let response = '';
		let settled = false;

		const settle = (callback, value) => {
			if (settled) return;
			settled = true;
			callback(value);
		};

		socket.setEncoding('utf8');
		socket.setTimeout(5000);
		socket.once('connect', () => {
			socket.write(
				[
					`GET ${path} HTTP/1.1`,
					`Host: 127.0.0.1:${port}`,
					'Connection: Upgrade',
					'Upgrade: websocket',
					'Sec-WebSocket-Version: 13',
					`Sec-WebSocket-Key: ${key}`,
					'\r\n'
				].join('\r\n')
			);
		});
		socket.on('data', (chunk) => {
			response += chunk;
		});
		socket.once('end', () => settle(resolveResponse, response));
		socket.once('close', () => settle(resolveResponse, response));
		socket.once('timeout', () => {
			socket.destroy();
			settle(reject, new Error(`Timed out waiting for websocket upgrade response:\n${response}`));
		});
		socket.once('error', (error) => settle(reject, error));
	});
}

function stopChild(child) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

	return new Promise((resolveStop) => {
		const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
		child.once('exit', () => {
			clearTimeout(killTimer);
			resolveStop();
		});
		child.kill('SIGTERM');
	});
}

function formatLogs(logs) {
	return [
		`stdout:\n${logs.stdout.trim() || '<empty>'}`,
		`stderr:\n${logs.stderr.trim() || '<empty>'}`
	].join('\n');
}
