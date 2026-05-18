import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { delay, findAvailablePort, stopChild } from './smoke-app-runtime.mjs';

const postgresImage = process.env.TERMKIT_SMOKE_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const postgresUser = 'termkit';
const postgresPassword = 'termkit_app_smoke_password';
const postgresDb = 'termkit_app_smoke';

export async function startOrUseApp({
	gatewayUrl,
	root,
	tempDir,
	timeoutMs,
	execFile,
	runChecked,
	waitForHttp
}) {
	const existingBaseUrl = process.env.TERMKIT_SMOKE_APP_BASE_URL;
	if (existingBaseUrl) {
		return {
			baseUrl: existingBaseUrl.replace(/\/$/, ''),
			databaseUrl: process.env.TERMKIT_SMOKE_DATABASE_URL ?? process.env.DATABASE_URL ?? null,
			logs: null,
			close: async () => {}
		};
	}

	const postgres =
		process.env.TERMKIT_SMOKE_DATABASE_URL === undefined
			? await startIsolatedPostgres({ tempDir, timeoutMs, execFile })
			: null;
	const databaseUrl = process.env.TERMKIT_SMOKE_DATABASE_URL ?? postgres?.databaseUrl;
	if (!databaseUrl) throw new Error('Smoke app database URL could not be resolved.');
	await runMigrations({ databaseUrl, execFile, runChecked });

	const port = Number(process.env.TERMKIT_SMOKE_APP_PORT ?? (await findAvailablePort()));
	const baseUrl = `http://127.0.0.1:${port}`;
	const logs = { stdout: '', stderr: '' };
	const appEnv = {
		...process.env,
		NODE_ENV: 'production',
		HOST: '127.0.0.1',
		PORT: String(port),
		ORIGIN: baseUrl,
		TERMKIT_INSECURE_LOCAL_HTTP: '1',
		BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT ?? '55M',
		DATABASE_URL: databaseUrl,
		APP_SECRET: process.env.APP_SECRET ?? 'B8dF1hJ3kL5mN7pR9tV2wX4yZ6aC8eG0',
		CREDENTIAL_MASTER_KEY: process.env.CREDENTIAL_MASTER_KEY ?? 'H7jK9mN2pQ4rS6tV8wX0yZ1aB3cD5eF6',
		TERMKIT_SSH_KNOWN_HOSTS_PATH:
			process.env.TERMKIT_SSH_KNOWN_HOSTS_PATH ?? join(tempDir, 'ssh-known-hosts.json'),
		TERMKIT_SSH_TRUST_ON_FIRST_USE: process.env.TERMKIT_SSH_TRUST_ON_FIRST_USE ?? '1',
		TERMKIT_SSH_ALLOW_PRODUCTION_TOFU: process.env.TERMKIT_SSH_ALLOW_PRODUCTION_TOFU ?? '1',
		GATEWAY_URL: process.env.GATEWAY_URL ?? gatewayUrl ?? 'http://127.0.0.1:7171',
		GATEWAY_PUBLIC_URL: process.env.GATEWAY_PUBLIC_URL ?? `${baseUrl}/gateway`,
		GATEWAY_PROVISIONER_KEY: process.env.GATEWAY_PROVISIONER_KEY ?? 'app-smoke-local-key'
	};

	const appProcess = spawn(
		process.execPath,
		['--input-type=module', '--eval', productionStartSource()],
		{
			cwd: root,
			env: appEnv,
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	appProcess.stdout.setEncoding('utf8');
	appProcess.stderr.setEncoding('utf8');
	appProcess.stdout.on('data', (chunk) => {
		logs.stdout += chunk;
	});
	appProcess.stderr.on('data', (chunk) => {
		logs.stderr += chunk;
	});

	await waitForHttp(baseUrl, appProcess, logs);
	return {
		baseUrl,
		databaseUrl,
		logs,
		close: async () => {
			await stopChild(appProcess);
			await postgres?.close();
		}
	};
}

function productionStartSource() {
	return [
		"import { validateProductionEnv } from './scripts/validate-production-env.mjs';",
		'validateProductionEnv();',
		"const serverModule = await import('./build/server.js');",
		"if (typeof serverModule.startTermixServer === 'function') {",
		'  await serverModule.startTermixServer(process.env);',
		'} else {',
		"  await import('./scripts/start-production.mjs');",
		'}'
	].join('\n');
}

async function startIsolatedPostgres({ tempDir, timeoutMs, execFile }) {
	const postgresContainerName = `termkit-app-smoke-${process.pid}-${Date.now()}`;
	const close = async () => {
		await execFile('docker', ['stop', '--time', '5', postgresContainerName]).catch(() => {});
	};

	await execFile('docker', [
		'run',
		'--detach',
		'--rm',
		'--name',
		postgresContainerName,
		'--publish',
		'127.0.0.1::5432',
		'--env',
		`POSTGRES_USER=${postgresUser}`,
		'--env',
		`POSTGRES_PASSWORD=${postgresPassword}`,
		'--env',
		`POSTGRES_DB=${postgresDb}`,
		postgresImage
	]);
	await writeFile(join(tempDir, 'postgres-container'), postgresContainerName, 'utf8');

	const hostPort = await readPostgresPort({ name: postgresContainerName, timeoutMs, execFile });
	await waitForPostgres({ name: postgresContainerName, timeoutMs, execFile });
	return {
		databaseUrl: `postgres://${postgresUser}:${postgresPassword}@127.0.0.1:${hostPort}/${postgresDb}`,
		close
	};
}

async function readPostgresPort({ name, timeoutMs, execFile }) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { stdout } = await execFile('docker', ['port', name, '5432/tcp']);
		const port = /:(\d+)$/.exec(stdout.trim().split('\n')[0])?.[1];
		if (port) return port;
		await delay(250);
	}
	throw new Error('Timed out waiting for isolated Postgres port mapping.');
}

async function waitForPostgres({ name, timeoutMs, execFile }) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await execFile('docker', ['exec', name, 'pg_isready', '-U', postgresUser, '-d', postgresDb]);
			return;
		} catch {
			await delay(500);
		}
	}
	throw new Error('Timed out waiting for isolated Postgres to become healthy.');
}

async function runMigrations({ databaseUrl, runChecked }) {
	if (process.env.TERMKIT_SMOKE_SKIP_MIGRATIONS === '1') return;
	const attempts = Number(process.env.TERMKIT_SMOKE_MIGRATION_ATTEMPTS ?? '5');
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			await runChecked(process.execPath, ['scripts/migrate.mjs'], {
				...process.env,
				DATABASE_URL: databaseUrl
			});
			return;
		} catch (error) {
			if (attempt === attempts) throw error;
			console.warn(`Drizzle migration attempt ${attempt} failed; retrying.`);
			await delay(1_000);
		}
	}
}
