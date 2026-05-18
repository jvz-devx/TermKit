import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultMigrationsFolder = resolve(root, 'drizzle');
const defaultReadyTimeoutMs = 60_000;
const defaultReadyIntervalMs = 1_000;

export async function runProductionMigrations(options = {}) {
	const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
	const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;
	const readyTimeoutMs =
		options.readyTimeoutMs ??
		readIntegerEnv('TERMKIT_DB_READY_TIMEOUT_MS', defaultReadyTimeoutMs, 1_000, 600_000);
	const readyIntervalMs =
		options.readyIntervalMs ??
		readIntegerEnv('TERMKIT_DB_READY_INTERVAL_MS', defaultReadyIntervalMs, 100, 30_000);

	if (!databaseUrl) {
		throw new Error('DATABASE_URL is not set.');
	}

	if (!existsSync(migrationsFolder)) {
		throw new Error(`Drizzle migrations folder is missing: ${migrationsFolder}`);
	}

	await waitForDatabase(databaseUrl, { readyTimeoutMs, readyIntervalMs });

	const client = postgres(databaseUrl, { max: 1 });
	const db = drizzle(client);

	try {
		console.log(`Running Drizzle migrations from ${migrationsFolder}`);
		await migrate(db, { migrationsFolder });
		console.log('Drizzle migrations completed.');
	} finally {
		await client.end();
	}
}

async function waitForDatabase(databaseUrl, { readyTimeoutMs, readyIntervalMs }) {
	const deadline = Date.now() + readyTimeoutMs;
	let attempt = 0;
	let lastError;

	while (Date.now() <= deadline) {
		attempt += 1;
		const client = postgres(databaseUrl, { max: 1 });
		try {
			await client`select 1`;
			if (attempt > 1) console.log('Database is ready.');
			return;
		} catch (error) {
			lastError = error;
			if (attempt === 1) {
				console.log(`Waiting for database readiness for up to ${readyTimeoutMs}ms...`);
			}
		} finally {
			await client.end().catch(() => {});
		}

		await delay(readyIntervalMs);
	}

	throw new Error(`Database did not become ready: ${errorMessage(lastError)}`);
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

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
