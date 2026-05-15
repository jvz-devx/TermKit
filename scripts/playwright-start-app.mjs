import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { playwrightStatePath } from './playwright-state.mjs';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.PLAYWRIGHT_HOST ?? '127.0.0.1';
const port = process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? '4173';
const origin = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;
const postgresImage = process.env.PLAYWRIGHT_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const postgresUser = 'termixkit';
const postgresPassword = 'termixkit_e2e_password';
const postgresDb = 'termixkit_e2e';
const statePath = playwrightStatePath(root);

let containerName;
let appProcess;
let tempDir;
let shuttingDown = false;

try {
	tempDir = await mkdtemp(join(tmpdir(), 'termixkit-e2e-'));
	const databaseUrl = process.env.PLAYWRIGHT_DATABASE_URL ?? (await startIsolatedPostgres());

	await runMigrations(databaseUrl);
	startApp(databaseUrl);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	await cleanup();
	process.exit(1);
}

process.on('SIGINT', () => void shutdown(130));
process.on('SIGTERM', () => void shutdown(143));

async function startIsolatedPostgres() {
	containerName = `termixkit-e2e-${process.pid}-${Date.now()}`;

	await execFile('docker', [
		'run',
		'--detach',
		'--rm',
		'--name',
		containerName,
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
	await writeFile(statePath, JSON.stringify({ containerName }), 'utf8');

	const hostPort = await readPostgresPort(containerName);
	const databaseUrl = `postgres://${postgresUser}:${postgresPassword}@127.0.0.1:${hostPort}/${postgresDb}`;
	await waitForPostgres(databaseUrl);
	console.log(`Playwright isolated Postgres is ready on 127.0.0.1:${hostPort}.`);

	return databaseUrl;
}

async function readPostgresPort(name) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const { stdout } = await execFile('docker', ['port', name, '5432/tcp']);
		const line = stdout.trim().split('\n')[0];
		const portMatch = /:(\d+)$/.exec(line);

		if (portMatch) return portMatch[1];
		await delay(250);
	}

	throw new Error('Timed out waiting for the isolated Postgres port mapping.');
}

async function waitForPostgres(databaseUrl) {
	let lastError;

	for (let attempt = 0; attempt < 120; attempt += 1) {
		const sql = postgres(databaseUrl, { max: 1 });
		try {
			await sql`select 1`;
			await sql.end();
			return;
		} catch (error) {
			lastError = error;
			await sql.end({ timeout: 1 }).catch(() => {});
			await delay(250);
		}
	}

	throw new Error(
		`Timed out waiting for isolated Postgres to accept SQL connections: ${
			lastError instanceof Error ? lastError.message : 'unknown'
		}.`
	);
}

async function runMigrations(databaseUrl) {
	if (process.env.PLAYWRIGHT_SKIP_MIGRATIONS === '1') return;

	const attempts = Number(process.env.PLAYWRIGHT_MIGRATION_ATTEMPTS ?? '5');
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

function startApp(databaseUrl) {
	const appEnv = {
		...process.env,
		NODE_ENV: 'production',
		HOST: host,
		PORT: port,
		ORIGIN: origin,
		TERMIXKIT_INSECURE_LOCAL_HTTP: '1',
		BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT ?? '55M',
		DATABASE_URL: databaseUrl,
		APP_SECRET: process.env.APP_SECRET ?? 'd4YmG5uVPKHLb4xikqu47GzDL8RQXmyC4k53YmgW',
		CREDENTIAL_MASTER_KEY:
			process.env.CREDENTIAL_MASTER_KEY ?? 'v6iJdWKrREfzCd9vxRSYKSBQg35bNyamzsUGq2VL',
		TERMIXKIT_SSH_KNOWN_HOSTS_PATH:
			process.env.TERMIXKIT_SSH_KNOWN_HOSTS_PATH ?? join(tempDir, 'ssh-known-hosts.json'),
		TERMIXKIT_SSH_TRUST_ON_FIRST_USE: process.env.TERMIXKIT_SSH_TRUST_ON_FIRST_USE ?? '1',
		TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU: process.env.TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU ?? '1',
		GATEWAY_URL: process.env.GATEWAY_URL ?? 'http://127.0.0.1:7171',
		GATEWAY_PUBLIC_URL: process.env.GATEWAY_PUBLIC_URL ?? `${origin}/gateway`,
		GATEWAY_PROVISIONER_KEY: process.env.GATEWAY_PROVISIONER_KEY ?? 'playwright-local-key'
	};

	appProcess = spawn(process.execPath, ['scripts/start-production.mjs'], {
		cwd: root,
		env: appEnv,
		stdio: 'inherit'
	});

	appProcess.on('exit', (code, signal) => {
		if (shuttingDown) return;

		if (signal) {
			console.error(`TermixKit exited from signal ${signal}.`);
			void shutdown(1);
			return;
		}

		void shutdown(code ?? 1);
	});
}

async function runChecked(command, args, env) {
	await new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });

		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}

			reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
		});
	});
}

async function shutdown(code) {
	if (shuttingDown) return;
	shuttingDown = true;

	if (appProcess && !appProcess.killed) {
		appProcess.kill('SIGTERM');
	}

	await cleanup();
	process.exit(code);
}

async function cleanup() {
	if (containerName) {
		try {
			await execFile('docker', ['stop', '--time', '5', containerName]);
		} catch {
			// The container may already be gone if Docker or Playwright killed it first.
		}
	}

	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}

	await rm(statePath, { force: true });
}

function delay(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
