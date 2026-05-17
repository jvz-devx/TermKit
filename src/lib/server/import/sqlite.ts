import { ServiceValidationError } from '$lib/server/services/errors';
import type { TermixSourceProtocol, TermixSourceRecord } from './termix';
import { SqliteDatabase, type SqliteRow, type SqliteTable } from './sqlite-reader';

export { isSqliteBuffer } from './sqlite-reader';

type SqliteCredential = {
	sourceId: string;
	name?: string;
	username?: string;
	source: Record<string, unknown>;
};

const SUPPORTED_TABLES = new Set([
	'connections',
	'connection',
	'hosts',
	'host',
	'servers',
	'server',
	'ssh_data',
	'rdp_data',
	'vnc_data',
	'telnet_data'
]);

const TABLE_PROTOCOLS = new Map<string, TermixSourceProtocol>([
	['ssh_data', 'ssh'],
	['rdp_data', 'rdp'],
	['vnc_data', 'vnc'],
	['telnet_data', 'telnet']
]);

export function parseTermixSqliteDatabase(bytes: Uint8Array): TermixSourceRecord[] {
	const database = new SqliteDatabase(bytes);
	const schema = database.readSchema();
	const tables = schema.filter((table) => SUPPORTED_TABLES.has(table.name));

	if (tables.length === 0) {
		throw new ServiceValidationError([
			'SQLite import did not include a supported Termix host table.'
		]);
	}

	const credentials = readSqliteCredentials(
		database,
		schema.find((table) => table.name === 'ssh_credentials')
	);

	return tables.flatMap((table) =>
		database
			.readTable(table)
			.map((row, index) => sqliteRowToTermixRecord(table, row, index, credentials))
	);
}

function sqliteRowToTermixRecord(
	table: SqliteTable,
	row: SqliteRow,
	index: number,
	credentials: Map<string, SqliteCredential>
): TermixSourceRecord {
	const json = parseJsonColumns(row);
	const source = normalizeObjectKeys({ ...row, ...json });
	const tableProtocol = TABLE_PROTOCOLS.get(table.name);
	const rowProtocol = sourceString(source, [
		'protocol',
		'connection_type',
		'connectionType',
		'type'
	]);
	const id =
		sourceString(source, ['id', 'uuid', 'connection_id', 'rowid']) ?? `${table.name}-${index + 1}`;
	const credentialId = sourceString(source, ['credential_id', 'credentialId']);
	const linkedCredential = credentialId ? credentials.get(credentialId) : undefined;
	const credentialSource = linkedCredential?.source ?? {};

	return {
		id,
		name: sourceString(source, ['name', 'label', 'title']),
		label: sourceString(source, ['label']),
		protocol: rowProtocol ?? tableProtocol,
		connectionType: rowProtocol ?? tableProtocol,
		hostname: sourceString(source, ['hostname', 'host', 'address', 'ip', 'ip_address', 'server']),
		host: sourceString(source, ['host']),
		address: sourceString(source, ['address']),
		ip: sourceString(source, ['ip', 'ip_address']),
		port: sourceNumberOrString(source, ['port']),
		username: sourceString(source, ['username', 'user', 'login']),
		user: sourceString(source, ['user']),
		password:
			sourceSecret(source, ['password', 'pass', 'secret']) ??
			sourceSecret(credentialSource, ['password', 'pass', 'secret']),
		privateKey:
			sourceSecret(source, ['private_key', 'privateKey', 'ssh_private_key']) ??
			sourceSecret(credentialSource, ['private_key', 'privateKey', 'ssh_private_key']),
		sshKey:
			sourceSecret(source, ['ssh_key', 'sshKey']) ??
			sourceSecret(credentialSource, ['ssh_key', 'sshKey']),
		key: sourceSecret(source, ['key']) ?? sourceSecret(credentialSource, ['key']),
		credentialSourceId: linkedCredential?.sourceId,
		credentialName: linkedCredential?.name,
		credentialUsername: linkedCredential?.username,
		domain: sourceString(source, ['domain']),
		folder: sourceString(source, ['folder', 'folder_name', 'group', 'group_name', 'category']),
		tags: sourceString(source, ['tags', 'tag']),
		notes: sourceString(source, ['notes', 'note', 'description', 'comment']),
		snippetId: sourceNumberOrString(source, ['snippet_id', 'snippetId']),
		guacamoleConfig: sourceRecord(source, ['guacamole_config', 'guacamoleConfig']),
		serverStats: sourceRecord(source, ['server_stats', 'serverStats']),
		raw: stringifyBinaryValues(row)
	};
}

function readSqliteCredentials(
	database: SqliteDatabase,
	table: SqliteTable | undefined
): Map<string, SqliteCredential> {
	const credentials = new Map<string, SqliteCredential>();
	if (!table) return credentials;

	for (const [index, row] of database.readTable(table).entries()) {
		const json = parseJsonColumns(row);
		const source = normalizeObjectKeys({ ...row, ...json });
		const id = sourceString(source, ['id', 'uuid', 'credential_id', 'rowid']);
		if (!id) continue;

		const credential: SqliteCredential = {
			sourceId: `ssh_credentials:${id}`,
			name: sourceString(source, ['name', 'label', 'title']) ?? `Termix credential ${index + 1}`,
			username: sourceString(source, ['username', 'user', 'login']),
			source
		};

		credentials.set(id, credential);
		const rowid = sourceString(source, ['rowid']);
		if (rowid) credentials.set(rowid, credential);
	}

	return credentials;
}

function parseJsonColumns(row: SqliteRow): Record<string, unknown> {
	const merged: Record<string, unknown> = {};

	for (const key of ['data', 'config', 'settings', 'connection', 'metadata']) {
		const value = row[key];
		if (typeof value !== 'string') continue;

		try {
			const parsed = JSON.parse(value);
			if (isRecord(parsed)) Object.assign(merged, parsed);
		} catch {
			// Non-JSON text columns are common in Termix exports and are ignored here.
		}
	}

	return merged;
}

function normalizeObjectKeys(source: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(source).map(([key, value]) => [normalizeKey(key), value])
	);
}

function sourceString(source: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = source[normalizeKey(key)];
		if (typeof value === 'string' && value.trim()) return value.trim();
		if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	}
	return undefined;
}

function sourceNumberOrString(
	source: Record<string, unknown>,
	keys: string[]
): string | number | undefined {
	for (const key of keys) {
		const value = source[normalizeKey(key)];
		if (typeof value === 'string' && value.trim()) return value.trim();
		if (typeof value === 'number' && Number.isFinite(value)) return value;
	}
	return undefined;
}

function sourceSecret(
	source: Record<string, unknown>,
	keys: string[]
): string | Record<string, unknown> | undefined {
	for (const key of keys) {
		const value = source[normalizeKey(key)];
		if (typeof value === 'string' && value.trim()) return value.trim();
		if (isRecord(value)) return value;
	}
	return undefined;
}

function sourceRecord(
	source: Record<string, unknown>,
	keys: string[]
): Record<string, unknown> | undefined {
	for (const key of keys) {
		const value = source[normalizeKey(key)];
		if (isRecord(value)) return value;
		if (typeof value === 'string' && value.trim().startsWith('{')) {
			try {
				const parsed = JSON.parse(value);
				if (isRecord(parsed)) return parsed;
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

function stringifyBinaryValues(row: SqliteRow): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [
			key,
			value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value
		])
	);
}

function normalizeKey(key: string): string {
	return key.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
