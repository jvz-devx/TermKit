import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(root, 'compose.yaml');
const timeoutMs = readIntegerEnv('TERMKIT_SMOKE_COMPOSE_TIMEOUT_MS', 900_000, 60_000, 1_800_000);
const projectName = `termkit-smoke-${process.pid}-${Date.now()}`;
const tempDir = await mkdtemp(join(tmpdir(), 'termkit-compose-smoke-'));
const envFile = join(tempDir, '.env');
const cleanup = [];
const results = [];

try {
	const appPort = await findAvailablePort();
	const postgresPort = await findAvailablePort();
	await writeFile(envFile, composeEnv(appPort, postgresPort), { mode: 0o600 });
	cleanup.push(() => rm(tempDir, { recursive: true, force: true }));

	await runCompose(['config', '--quiet']);
	pass('compose config', 'compose.yaml rendered with generated local smoke env');

	cleanup.push(() => composeDown());
	await runCompose(['up', '--detach', '--build']);
	pass('compose up', `project ${projectName}`);

	await waitForApp(`http://127.0.0.1:${appPort}`);
	pass('app HTTP boundary', `unauthenticated API returned 401 on port ${appPort}`);

	await assertPublishedPorts(appPort, postgresPort);
	pass(
		'compose port exposure',
		'app published one public HTTP port, postgres stayed loopback, gateway stayed internal'
	);

	printResults(console.log);
} catch (error) {
	printResults(console.error);
	console.error(error instanceof Error ? error.stack || error.message : error);
	process.exitCode = 1;
} finally {
	await runCleanup(cleanup);
}

process.exit(process.exitCode ?? 0);

function composeEnv(appPort, postgresPort) {
	return [
		`ORIGIN=http://localhost:${appPort}`,
		'TERMKIT_INSECURE_LOCAL_HTTP=1',
		`APP_PORT=${appPort}`,
		'POSTGRES_USER=termkit',
		`POSTGRES_PASSWORD=${secret()}`,
		'POSTGRES_DB=termkit',
		`POSTGRES_PORT=${postgresPort}`,
		`APP_SECRET=${secret()}`,
		`CREDENTIAL_MASTER_KEY=${secret()}`,
		'MICROSOFT_AUTH_ENABLED=0',
		'GATEWAY_URL=http://gateway:7171',
		`GATEWAY_PUBLIC_URL=http://localhost:${appPort}/gateway`,
		`GATEWAY_PROVISIONER_KEY=${secret()}`,
		'DGW_SUBJECT=localhost',
		''
	].join('\n');
}

function secret() {
	return randomBytes(32).toString('base64url');
}

async function runCompose(args) {
	const composeFiles = ['-f', composeFile];
	const dnsOverride = process.env.TERMKIT_COMPOSE_DNS_OVERRIDE?.trim();
	if (dnsOverride && existsSync(dnsOverride)) {
		composeFiles.push('-f', dnsOverride);
	}

	return execFile(
		'docker',
		['compose', '--project-name', projectName, '--env-file', envFile, ...composeFiles, ...args],
		{
			cwd: root,
			timeout: timeoutMs,
			maxBuffer: 20 * 1024 * 1024
		}
	);
}

async function composeDown() {
	await runCompose(['down', '--volumes', '--remove-orphans', '--timeout', '5']).catch(() => {});
}

async function waitForApp(baseUrl) {
	const deadline = Date.now() + timeoutMs;
	let lastError;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${baseUrl}/api/hosts`, { redirect: 'manual' });
			if (response.status === 401) return;
			lastError = new Error(`expected 401 from /api/hosts, received ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await delay(1000);
	}

	throw new Error(
		`Compose app did not become ready within ${timeoutMs}ms: ${errorMessage(lastError)}`
	);
}

async function assertPublishedPorts(appPort, postgresPort) {
	const appPortOutput = await composePort('app', '3000');
	assert(
		appPortOutput.includes(`:${appPort}`),
		`expected app service to publish container port 3000 on ${appPort}, got ${appPortOutput || '<none>'}`
	);

	const postgresPortOutput = await composePort('postgres', '5432');
	assert(
		postgresPortOutput.startsWith('127.0.0.1:') && postgresPortOutput.endsWith(`:${postgresPort}`),
		`expected postgres service to publish only on loopback ${postgresPort}, got ${postgresPortOutput || '<none>'}`
	);

	const gatewayPortOutput = await composePort('gateway', '7171');
	assert(
		gatewayPortOutput === '' || gatewayPortOutput === ':0',
		`expected gateway service to have no published public port, got ${gatewayPortOutput}`
	);
}

async function composePort(service, port) {
	try {
		const { stdout } = await runCompose(['port', service, port]);
		return stdout.trim();
	} catch {
		return '';
	}
}

async function findAvailablePort() {
	const server = createServer();
	await new Promise((resolvePromise, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolvePromise);
	});
	const address = server.address();
	await new Promise((resolvePromise, reject) => {
		server.close((error) => (error ? reject(error) : resolvePromise()));
	});
	if (!address || typeof address === 'string') throw new Error('Could not allocate smoke port');
	return address.port;
}

function pass(name, detail) {
	results.push({ status: '[pass]', name, detail });
}

function printResults(write) {
	for (const result of results) {
		const suffix = result.detail ? ` - ${result.detail}` : '';
		write(`${result.status} ${result.name}${suffix}`);
	}
}

async function runCleanup(callbacks) {
	for (const callback of callbacks.reverse()) {
		await callback().catch((error) => {
			console.error(`cleanup failed: ${errorMessage(error)}`);
		});
	}
}

function readIntegerEnv(name, fallback, min, max) {
	const value = process.env[name];
	if (!value) return fallback;

	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`${name} must be an integer from ${min} to ${max}`);
	}
	return parsed;
}

function delay(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
