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
	'approval_requests',
	'auth_identities',
	'automation_templates',
	'background_jobs',
	'command_snippets',
	'connection_sessions',
	'credentials',
	'file_bookmarks',
	'ftps_host_settings',
	'host_facts',
	'host_health',
	'hosts',
	'import_jobs',
	'job_events',
	'job_reports',
	'job_targets',
	'operation_reasons',
	'rdp_host_settings',
	'session_tickets',
	'sessions',
	'settings',
	'ssh_attach_tickets',
	'ssh_live_sessions',
	'terminal_preferences',
	'terminal_recordings',
	'users',
	'workspace_policies'
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

		const [sshLiveSessionStatus] = await sql`
			select exists (
				select 1
				from pg_type
				where typname = 'ssh_live_session_status'
			) as exists
		`;

		if (!sshLiveSessionStatus?.exists) {
			throw new Error('Migration did not create ssh_live_session_status enum.');
		}

		const [sshAttachTicketUniqueIndex] = await sql`
			select to_regclass('public.ssh_attach_tickets_ticket_hash_unique') as index_name
		`;

		if (!sshAttachTicketUniqueIndex?.index_name) {
			throw new Error('Migration did not create SSH attach ticket hash unique index.');
		}

		const [sshLiveSessionUserForeignKey] = await sql`
			select confdeltype
			from pg_constraint
			where conname = 'ssh_live_sessions_user_id_users_id_fk'
		`;

		if (sshLiveSessionUserForeignKey?.confdeltype !== 'c') {
			throw new Error('Migration did not create cascading SSH live session user foreign key.');
		}

		const [sshAttachTicketSessionForeignKey] = await sql`
			select confdeltype
			from pg_constraint
			where conname = 'ssh_attach_tickets_ssh_live_session_id_ssh_live_sessions_id_fk'
		`;

		if (sshAttachTicketSessionForeignKey?.confdeltype !== 'c') {
			throw new Error(
				'Migration did not create cascading SSH attach ticket live-session foreign key.'
			);
		}

		const [terminalRecordingStatus] = await sql`
			select exists (
				select 1
				from pg_type
				where typname = 'terminal_recording_status'
			) as exists
		`;

		if (!terminalRecordingStatus?.exists) {
			throw new Error('Migration did not create terminal_recording_status enum.');
		}

		const [ftpsMode] = await sql`
			select exists (
				select 1
				from pg_type
				where typname = 'ftps_mode'
			) as exists
		`;

		if (!ftpsMode?.exists) {
			throw new Error('Migration did not create ftps_mode enum.');
		}

		const [fileTransferProtocol] = await sql`
			select exists (
				select 1
				from pg_type
				where typname = 'file_transfer_protocol'
			) as exists
		`;

		if (!fileTransferProtocol?.exists) {
			throw new Error('Migration did not create file_transfer_protocol enum.');
		}

		const v5UniqueIndexes = [
			'terminal_preferences_user_host_unique',
			'file_bookmarks_user_host_path_unique',
			'ftps_host_settings_user_host_unique',
			'rdp_host_settings_user_host_unique'
		];

		for (const indexName of v5UniqueIndexes) {
			const [row] = await sql`
				select to_regclass(${`public.${indexName}`}) as index_name
			`;

			if (!row?.index_name) {
				throw new Error(`Migration did not create ${indexName}.`);
			}
		}

		const [recordingConnectionSessionForeignKey] = await sql`
			select confdeltype
			from pg_constraint
			where conname = 'terminal_recordings_connection_session_id_connection_sessions_id_fk'
		`;

		if (recordingConnectionSessionForeignKey?.confdeltype !== 'n') {
			throw new Error(
				'Migration did not create set-null terminal recording connection-session foreign key.'
			);
		}

		const v6Enums = [
			'approval_request_status',
			'automation_template_kind',
			'automation_template_visibility',
			'automation_variable_kind',
			'background_job_kind',
			'background_job_status',
			'host_fact_source',
			'host_health_state',
			'job_event_severity',
			'job_report_format',
			'job_target_status',
			'workspace_policy_capability',
			'workspace_policy_effect'
		];

		for (const enumName of v6Enums) {
			const [row] = await sql`
				select exists (
					select 1
					from pg_type
					where typname = ${enumName}
				) as exists
			`;

			if (!row?.exists) {
				throw new Error(`Migration did not create ${enumName} enum.`);
			}
		}

		const v6UniqueIndexes = [
			'job_targets_job_host_unique',
			'host_facts_host_unique',
			'host_health_host_unique',
			'workspace_policies_workspace_capability_unique'
		];

		for (const indexName of v6UniqueIndexes) {
			const [row] = await sql`
				select to_regclass(${`public.${indexName}`}) as index_name
			`;

			if (!row?.index_name) {
				throw new Error(`Migration did not create ${indexName}.`);
			}
		}

		const v6ForeignKeys = new Map([
			['background_jobs_template_id_automation_templates_id_fk', 'n'],
			['job_targets_job_id_background_jobs_id_fk', 'c'],
			['job_events_job_id_background_jobs_id_fk', 'c'],
			['job_reports_job_id_background_jobs_id_fk', 'c'],
			['workspace_policies_workspace_id_workspaces_id_fk', 'c'],
			['approval_requests_requested_by_users_id_fk', 'c'],
			['operation_reasons_user_id_users_id_fk', 'c'],
			['host_facts_host_id_hosts_id_fk', 'c'],
			['host_health_host_id_hosts_id_fk', 'c']
		]);

		for (const [constraintName, expectedDeleteAction] of v6ForeignKeys) {
			const [row] = await sql`
				select confdeltype
				from pg_constraint
				where conname = ${constraintName}
			`;

			if (row?.confdeltype !== expectedDeleteAction) {
				throw new Error(`Migration did not create expected delete action for ${constraintName}.`);
			}
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
