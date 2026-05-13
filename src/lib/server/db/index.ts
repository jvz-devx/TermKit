import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type TermixDb = PostgresJsDatabase<typeof schema>;

let cachedDb: TermixDb | null = null;

export function createDb(databaseUrl = env.DATABASE_URL): TermixDb {
	if (!databaseUrl) throw new Error('DATABASE_URL is not set');
	return drizzle(postgres(databaseUrl), { schema }) as TermixDb;
}

export function getDb(): TermixDb {
	cachedDb ??= createDb();
	return cachedDb;
}

export const db = new Proxy({} as TermixDb, {
	get(_target, property) {
		const database = getDb();
		const value = Reflect.get(database, property);
		return typeof value === 'function' ? value.bind(database) : value;
	}
});
