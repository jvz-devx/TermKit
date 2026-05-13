import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrateScript = resolve(root, 'scripts/migrate.mjs');
const image = process.env.TERMIXKIT_SMOKE_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const database = 'termixkit_migration_smoke';
const username = 'termixkit_migration_smoke';
const password = `termixkit-smoke-${randomBytes(18).toString('base64url')}`;
const containerName = `termixkit-postgres-migration-smoke-${process.pid}-${Date.now().toString(36)}`;
const expectedTables = [
	'auth_identities',
	'connection_sessions',
	'credentials',
	'hosts',
	'import_jobs',
	'session_tickets',
	'sessions',
	'settings',
	'users'
];

try {
	await assertDockerAvailable();
	await startPostgresContainer();

	const port = await getMappedPort();
	const databaseUrl = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(
		password
	)}@127.0.0.1:${port}/${database}`;

	await waitForPostgres(databaseUrl);
	await runMigration(databaseUrl);
	await verifyMigratedSchema(databaseUrl);

	console.log(
		`postgres migration smoke: verified ${expectedTables.length} public tables and Drizzle journal`
	);
} finally {
	await removePostgresContainer();
}

async function assertDockerAvailable() {
	try {
		await run('docker', ['version', '--format', '{{.Server.Version}}'], {
			label: 'docker version'
		});
	} catch (error) {
		throw new Error(`Docker is required for the Postgres migration smoke.\n${error.message}`, {
			cause: error
		});
	}
}

function startPostgresContainer() {
	return run(
		'docker',
		[
			'run',
			'--detach',
			'--name',
			containerName,
			'--publish',
			'127.0.0.1::5432',
			'--env',
			'POSTGRES_USER',
			'--env',
			'POSTGRES_PASSWORD',
			'--env',
			'POSTGRES_DB',
			image
		],
		{
			env: {
				...process.env,
				POSTGRES_DB: database,
				POSTGRES_PASSWORD: password,
				POSTGRES_USER: username
			},
			label: 'docker run postgres'
		}
	);
}

async function getMappedPort() {
	const deadline = Date.now() + 10_000;

	while (Date.now() < deadline) {
		const { stdout } = await run('docker', ['port', containerName, '5432/tcp'], {
			label: 'docker port postgres'
		});
		const port = parseMappedPort(stdout.trim());

		if (port) return port;
		await delay(100);
	}

	throw new Error('Timed out waiting for Docker to publish the Postgres port.');
}

function parseMappedPort(value) {
	const match = value.match(/:(\d+)$/);
	return match?.[1] ?? null;
}

async function waitForPostgres(url) {
	const deadline = Date.now() + 30_000;
	let lastError;

	while (Date.now() < deadline) {
		const sql = postgres(url, { max: 1 });
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

	throw new Error(`Timed out waiting for Postgres readiness: ${lastError?.message ?? 'unknown'}`);
}

function runMigration(url) {
	return run(process.execPath, [migrateScript], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: url },
		label: 'node scripts/migrate.mjs'
	});
}

async function verifyMigratedSchema(url) {
	const sql = postgres(url, { max: 1 });

	try {
		const tables = await sql`
			select table_name
			from information_schema.tables
			where table_schema = 'public'
				and table_type = 'BASE TABLE'
			order by table_name
		`;
		const actualTables = new Set(tables.map((row) => row.table_name));
		const missingTables = expectedTables.filter((table) => !actualTables.has(table));

		if (missingTables.length > 0) {
			throw new Error(`Migration did not create expected tables: ${missingTables.join(', ')}`);
		}

		const [journal] = await sql`
			select to_regclass('drizzle.__drizzle_migrations') as journal_table
		`;

		if (!journal?.journal_table) {
			throw new Error('Migration did not create drizzle.__drizzle_migrations.');
		}

		const [authIdentityProvider] = await sql`
			select exists (
				select 1
				from pg_type
				where typname = 'auth_identity_provider'
			) as exists
		`;

		if (!authIdentityProvider?.exists) {
			throw new Error('Migration did not create auth_identity_provider enum.');
		}

		const [authIdentityUniqueIndex] = await sql`
			select to_regclass('public.auth_identities_provider_tenant_subject_unique') as index_name
		`;

		if (!authIdentityUniqueIndex?.index_name) {
			throw new Error(
				'Migration did not create auth identity provider/tenant/subject unique index.'
			);
		}

		const [authIdentityForeignKey] = await sql`
			select confdeltype
			from pg_constraint
			where conname = 'auth_identities_user_id_users_id_fk'
		`;

		if (authIdentityForeignKey?.confdeltype !== 'c') {
			throw new Error('Migration did not create cascading auth identity user foreign key.');
		}
	} finally {
		await sql.end();
	}
}

async function removePostgresContainer() {
	await run('docker', ['rm', '--force', '--volumes', containerName], {
		allowFailure: true,
		label: 'docker rm postgres'
	});
}

function run(command, args, options = {}) {
	const { allowFailure = false, cwd = root, env = process.env, label = command } = options;

	return new Promise((resolveCommand, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.once('error', (error) => {
			if (allowFailure) {
				resolveCommand({ stdout, stderr, error });
				return;
			}

			reject(error);
		});
		child.once('close', (code, signal) => {
			if (code === 0 || allowFailure) {
				resolveCommand({ stdout, stderr, code, signal });
				return;
			}

			reject(new Error(`${label} failed with ${code ?? signal}\n${formatOutput(stdout, stderr)}`));
		});
	});
}

function formatOutput(stdout, stderr) {
	return [`stdout:\n${stdout.trim() || '<empty>'}`, `stderr:\n${stderr.trim() || '<empty>'}`].join(
		'\n'
	);
}

function delay(milliseconds) {
	return new Promise((resolveDelay) => {
		setTimeout(resolveDelay, milliseconds);
	});
}
