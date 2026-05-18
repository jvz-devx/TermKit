import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

export function createSmokeRuntime({ root, timeoutMs }) {
	async function runChecked(command, args, env) {
		await new Promise((resolveRun, reject) => {
			const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
			child.on('error', reject);
			child.on('exit', (code) => {
				if (code === 0) resolveRun();
				else
					reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
			});
		});
	}

	function waitForHttp(baseUrl, child, logs) {
		return new Promise((resolveReady, reject) => {
			const deadline = Date.now() + timeoutMs;
			const failIfExited = (code, signal) => {
				reject(
					new Error(`TermKit exited before becoming ready: ${code ?? signal}\n${formatLogs(logs)}`)
				);
			};
			child.once('exit', failIfExited);

			const poll = async () => {
				try {
					const response = await fetch(baseUrl, { redirect: 'manual' });
					child.off('exit', failIfExited);
					response.body?.cancel();
					resolveReady();
					return;
				} catch {
					if (Date.now() >= deadline) {
						child.off('exit', failIfExited);
						reject(new Error(`Timed out waiting for TermKit.\n${formatLogs(logs)}`));
						return;
					}
					setTimeout(poll, 100);
				}
			};
			void poll();
		});
	}

	async function waitFor(predicate, message) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await predicate()) return;
			await delay(50);
		}
		throw new Error(typeof message === 'function' ? await message() : message);
	}

	return { runChecked, waitForHttp, waitFor };
}

export function readJsonBody(request) {
	return new Promise((resolveBody, reject) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('error', reject);
		request.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			if (!raw) {
				resolveBody({});
				return;
			}

			try {
				resolveBody(JSON.parse(raw));
			} catch (error) {
				reject(error);
			}
		});
	});
}

export function writeJson(response, statusCode, value) {
	response.writeHead(statusCode, { 'content-type': 'application/json' });
	response.end(JSON.stringify(value));
}

export function writeText(response, statusCode, statusMessage, text) {
	response.writeHead(statusCode, statusMessage, { 'content-type': 'text/plain; charset=utf-8' });
	response.end(text);
}

export function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

export function listen(server) {
	server.listen(0, '127.0.0.1');
	return once(server, 'listening');
}

export function closeServer(server) {
	return new Promise((resolveClose) => {
		server.closeAllClients?.();
		server.closeAllConnections?.();
		if (!server.listening) {
			resolveClose();
			return;
		}
		server.close(() => resolveClose());
	});
}

export function findAvailablePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Could not allocate TCP port.')));
				return;
			}
			server.close((error) => (error ? reject(error) : resolvePort(address.port)));
		});
	});
}

export function stopChild(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolveStop) => {
		const killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
		child.once('exit', () => {
			clearTimeout(killTimer);
			resolveStop();
		});
		child.kill('SIGTERM');
	});
}

export async function runCleanup(callbacks) {
	for (const callback of callbacks.toReversed()) {
		try {
			await Promise.race([callback(), delay(5_000)]);
		} catch {
			// Best-effort cleanup after smoke failures.
		}
	}
}

export function bufferIncludes(buffer, needle) {
	return buffer.indexOf(needle) !== -1;
}

export function formatLogs(logs) {
	return [
		`stdout:\n${logs.stdout.trim() || '<empty>'}`,
		`stderr:\n${logs.stderr.trim() || '<empty>'}`
	].join('\n');
}

export function delay(ms) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
