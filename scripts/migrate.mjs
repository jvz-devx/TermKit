import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = resolve(root, 'drizzle');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
	console.error('DATABASE_URL is not set.');
	process.exit(1);
}

if (!existsSync(migrationsFolder)) {
	console.error(`Drizzle migrations folder is missing: ${migrationsFolder}`);
	process.exit(1);
}

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

try {
	console.log(`Running Drizzle migrations from ${migrationsFolder}`);
	await migrate(db, { migrationsFolder });
	console.log('Drizzle migrations completed.');
} finally {
	await client.end();
}
