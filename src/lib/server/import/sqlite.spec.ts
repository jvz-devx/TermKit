import { describe, expect, it } from 'vitest';
import { mapTermixRecords } from './termix';
import { parseTermixSqliteDatabase } from './sqlite';
import { parseImportUpload } from './service';

describe('parseTermixSqliteDatabase', () => {
	it('maps supported Termix connection tables into source records', () => {
		const database = createSqliteDatabase([
			{
				name: 'connections',
				columns: [
					'id',
					'name',
					'protocol',
					'hostname',
					'port',
					'username',
					'password',
					'folder',
					'tags',
					'notes',
					'serverStats'
				],
				rows: [
					[
						'prod',
						'Prod SSH',
						'ssh',
						'prod.example.test',
						2222,
						'deploy',
						'plain-password',
						'Production',
						'linux, primary',
						'Main SSH endpoint',
						'{"cpu":1}'
					]
				]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);

		expect(records[0]).toMatchObject({
			id: 'prod',
			name: 'Prod SSH',
			protocol: 'ssh',
			hostname: 'prod.example.test',
			port: 2222,
			username: 'deploy',
			folder: 'Production',
			tags: 'linux, primary',
			notes: 'Main SSH endpoint',
			serverStats: { cpu: 1 }
		});
		expect(mapped.hosts[0]).toMatchObject({
			sourceId: 'prod',
			hostname: 'prod.example.test',
			port: 2222,
			credentialRef: 'prod:password'
		});
		expect(mapped.credentials[0]).toMatchObject({
			sourceId: 'prod:password',
			secret: 'plain-password'
		});
		expect(mapped.warnings.map((warning) => warning.code)).toEqual(['unsupported_field']);
	});

	it('uses protocol-specific legacy table names when protocol columns are absent', () => {
		const database = createSqliteDatabase([
			{
				name: 'ssh_data',
				columns: ['id', 'label', 'ip_address', 'user', 'key'],
				rows: [['keyed', 'Keyed shell', '10.0.0.10', 'root', '-----BEGIN OPENSSH PRIVATE KEY-----']]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);

		expect(records[0]).toMatchObject({
			id: 'keyed',
			label: 'Keyed shell',
			protocol: 'ssh',
			ip: '10.0.0.10',
			user: 'root'
		});
		expect(mapped.hosts[0]).toMatchObject({
			protocol: 'ssh',
			hostname: '10.0.0.10',
			credentialRef: 'keyed:ssh-key'
		});
		expect(mapped.credentials[0]).toMatchObject({
			sourceId: 'keyed:ssh-key',
			kind: 'ssh_key'
		});
	});

	it('lets real Termix ssh_data connection_type override the table default', () => {
		const database = createSqliteDatabase([
			{
				name: 'ssh_data',
				columns: ['id', 'connection_type', 'name', 'ip', 'port', 'username'],
				rows: [['windows', 'rdp', 'Windows Admin', 'win.example.test', 3389, 'administrator']]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);

		expect(records[0]).toMatchObject({
			id: 'windows',
			protocol: 'rdp',
			connectionType: 'rdp'
		});
		expect(mapped.hosts[0]).toMatchObject({
			protocol: 'rdp',
			hostname: 'win.example.test',
			port: 3389
		});
	});

	it('links ssh_data rows to reusable ssh_credentials records', () => {
		const database = createSqliteDatabase([
			{
				name: 'ssh_credentials',
				columns: ['id', 'name', 'auth_type', 'username', 'password'],
				rows: [['cred-1', 'Shared prod password', 'password', 'deploy', 'reused-secret']]
			},
			{
				name: 'ssh_data',
				columns: ['id', 'connection_type', 'name', 'ip', 'port', 'username', 'credential_id'],
				rows: [
					['prod-a', 'ssh', 'Prod A', 'prod-a.example.test', 22, 'deploy', 'cred-1'],
					['prod-b', 'ssh', 'Prod B', 'prod-b.example.test', 22, 'deploy', 'cred-1']
				]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);

		expect(records[0]).toMatchObject({
			id: 'prod-a',
			password: 'reused-secret',
			credentialSourceId: 'ssh_credentials:cred-1',
			credentialName: 'Shared prod password',
			credentialUsername: 'deploy'
		});
		expect(mapped.credentials).toHaveLength(1);
		expect(mapped.credentials[0]).toMatchObject({
			sourceId: 'ssh_credentials:cred-1:password',
			name: 'Shared prod password',
			username: 'deploy',
			secret: 'reused-secret'
		});
		expect(mapped.hosts.map((host) => host.credentialRef)).toEqual([
			'ssh_credentials:cred-1:password',
			'ssh_credentials:cred-1:password'
		]);
	});

	it('merges JSON config columns and ignores malformed JSON text columns', () => {
		const database = createSqliteDatabase([
			{
				name: 'connections',
				columns: ['id', 'name', 'config', 'settings', 'metadata'],
				rows: [
					[
						'json-config',
						'JSON configured shell',
						'not-json',
						JSON.stringify({
							connection_type: 'ssh',
							host: 'json.example.test',
							port: 2222,
							username: 'deploy',
							tags: 'json, merged',
							server_stats: { cpu: 2 }
						}),
						JSON.stringify({
							folder: 'Imported',
							notes: 'Merged from metadata column'
						})
					]
				]
			}
		]);

		const [record] = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(record ? [record] : []);

		expect(record).toMatchObject({
			id: 'json-config',
			connectionType: 'ssh',
			hostname: 'json.example.test',
			port: 2222,
			username: 'deploy',
			folder: 'Imported',
			notes: 'Merged from metadata column',
			serverStats: { cpu: 2 }
		});
		expect(mapped.hosts[0]).toMatchObject({
			hostname: 'json.example.test',
			tags: ['json', 'merged'],
			folder: 'Imported',
			notes: 'Merged from metadata column'
		});
	});

	it('falls back to regular columns when JSON candidate columns are malformed or non-objects', () => {
		const database = createSqliteDatabase([
			{
				name: 'connections',
				columns: [
					'id',
					'name',
					'connection_type',
					'hostname',
					'port',
					'username',
					'data',
					'config',
					'settings',
					'server_stats',
					'guacamole_config'
				],
				rows: [
					[
						'json-fallback',
						'JSON fallback shell',
						'ssh',
						'fallback.example.test',
						'2222',
						'deploy',
						'"scalar-json"',
						'["array-json"]',
						'not-json',
						'{not-json',
						'{also-not-json'
					]
				]
			}
		]);

		const [record] = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(record ? [record] : []);

		expect(record).toMatchObject({
			id: 'json-fallback',
			connectionType: 'ssh',
			hostname: 'fallback.example.test',
			port: '2222',
			username: 'deploy'
		});
		expect(record?.serverStats).toBeUndefined();
		expect(record?.guacamoleConfig).toBeUndefined();
		expect(mapped.hosts[0]).toMatchObject({
			hostname: 'fallback.example.test',
			port: 2222,
			username: 'deploy'
		});
		expect(mapped.warnings).toEqual([]);
	});

	it('surfaces unsupported protocol and missing host warnings without leaking row secrets', () => {
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port', 'username', 'password'],
				rows: [
					[
						null,
						'Unsupported shell',
						'mosh',
						'unsupported.example.test',
						2222,
						'deploy',
						'unsupported-secret'
					],
					['missing-host', 'Missing host', 'ssh', null, 22, 'deploy', 'missing-host-secret']
				]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);
		const warningText = mapped.warnings.map((warning) => warning.message).join('\n');

		expect(records.map((record) => record.id)).toEqual(['1', 'missing-host']);
		expect(mapped.hosts).toEqual([]);
		expect(mapped.credentials).toEqual([]);
		expect(mapped.warnings.map((warning) => warning.code)).toEqual([
			'unsupported_protocol',
			'missing_hostname'
		]);
		expect(warningText).not.toContain('unsupported-secret');
		expect(warningText).not.toContain('missing-host-secret');
	});

	it('links hosts through ssh_credentials rowid aliases and ignores missing credential references', () => {
		const database = createSqliteDatabase([
			{
				name: 'ssh_credentials',
				columns: ['id', 'name', 'username', 'password'],
				rows: [['cred-a', 'Rowid credential', 'deploy', 'rowid-secret']]
			},
			{
				name: 'ssh_data',
				columns: ['id', 'connection_type', 'name', 'ip', 'port', 'username', 'credential_id'],
				rows: [
					['uses-rowid', 'ssh', 'Uses rowid', 'rowid.example.test', 22, 'ignored', '1'],
					['missing-cred', 'ssh', 'Missing credential', 'missing.example.test', 22, 'local', 'nope']
				]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);

		expect(records[0]).toMatchObject({
			id: 'uses-rowid',
			password: 'rowid-secret',
			credentialSourceId: 'ssh_credentials:cred-a',
			credentialUsername: 'deploy'
		});
		expect(records[1]).toMatchObject({
			id: 'missing-cred',
			credentialSourceId: undefined,
			password: undefined
		});
		expect(mapped.credentials).toHaveLength(1);
		expect(mapped.hosts.map((host) => host.credentialRef)).toEqual([
			'ssh_credentials:cred-a:password',
			undefined
		]);
		expect(mapped.hosts[0]?.username).toBe('ignored');
		expect(mapped.credentials[0]).toMatchObject({
			sourceId: 'ssh_credentials:cred-a:password',
			username: 'deploy',
			secret: 'rowid-secret',
			metadata: {
				sourceRecordId: 'uses-rowid',
				sourceCredentialId: 'ssh_credentials:cred-a'
			}
		});
	});

	it('keeps unsupported encrypted credential payloads out of failure warnings', () => {
		const secretPayload = 'encrypted:plain-secret-material-that-must-not-leak';
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port', 'username', 'password'],
				rows: [
					[
						'encrypted-host',
						'Encrypted host',
						'ssh',
						'encrypted.example.test',
						22,
						'deploy',
						secretPayload
					]
				]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records, { sourceSecret: 'wrong-source-secret' });

		expect(mapped.hosts).toHaveLength(1);
		expect(mapped.credentials).toEqual([]);
		expect(mapped.warnings).toEqual([
			{
				sourceId: 'encrypted-host',
				code: 'unsupported_encrypted_credential',
				message:
					'Encrypted password credential was not imported because its JSON format is not supported.'
			}
		]);
		expect(mapped.warnings[0]?.message).not.toContain(secretPayload);
		expect(mapped.warnings[0]?.message).not.toContain('plain-secret-material');
	});

	it('maps alternate connection columns into credentials, folders, tags, and domain metadata', () => {
		const database = createSqliteDatabase([
			{
				name: 'connections',
				columns: [
					'uuid',
					'title',
					'type',
					'server',
					'port',
					'login',
					'pass',
					'domain',
					'group_name',
					'tag',
					'comment'
				],
				rows: [
					[
						'edge-conn',
						'Edge Gateway',
						'sftp',
						'edge.example.test',
						'',
						'root',
						'edge-password',
						'corp.example',
						'Network Ops',
						'edge, jump',
						'Domain scoped access'
					]
				]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);

		expect(records[0]).toMatchObject({
			id: 'edge-conn',
			name: 'Edge Gateway',
			protocol: 'sftp',
			hostname: 'edge.example.test',
			username: 'root',
			password: 'edge-password',
			domain: 'corp.example',
			folder: 'Network Ops',
			tags: 'edge, jump',
			notes: 'Domain scoped access'
		});
		expect(mapped.hosts[0]).toMatchObject({
			protocol: 'ssh',
			hostname: 'edge.example.test',
			port: 22,
			username: 'root',
			folder: 'Network Ops',
			tags: ['edge', 'jump'],
			notes: 'Domain scoped access',
			metadata: { domain: 'corp.example' },
			credentialRef: 'edge-conn:password'
		});
		expect(mapped.credentials[0]).toMatchObject({
			sourceId: 'edge-conn:password',
			username: 'root',
			secret: 'edge-password'
		});
	});

	it('ignores malformed JSON settings without leaking embedded secrets into warnings', () => {
		const settingsSecret = 'settings-secret-that-must-not-leak';
		const columnSecret = 'column-secret-that-must-not-leak';
		const database = createSqliteDatabase([
			{
				name: 'connections',
				columns: ['id', 'name', 'protocol', 'host', 'port', 'username', 'password', 'settings'],
				rows: [
					[
						'bad-settings',
						'Bad settings',
						'ssh',
						'settings.example.test',
						'not-a-port',
						'deploy',
						columnSecret,
						`{"password":"${settingsSecret}",`
					]
				]
			}
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);
		const warningText = mapped.warnings.map((warning) => warning.message).join('\n');

		expect(records[0]).toMatchObject({
			id: 'bad-settings',
			password: columnSecret
		});
		expect(mapped.hosts).toEqual([]);
		expect(mapped.credentials).toEqual([]);
		expect(mapped.warnings).toEqual([
			{
				sourceId: 'bad-settings',
				code: 'invalid_port',
				message: 'Record has an invalid port "not-a-port".'
			}
		]);
		expect(warningText).not.toContain(settingsSecret);
		expect(warningText).not.toContain(columnSecret);
	});

	it('rejects SQLite databases without supported Termix host tables', () => {
		const database = createSqliteDatabase([
			{
				name: 'settings',
				columns: ['key', 'value'],
				rows: [['theme', 'dark']]
			}
		]);

		expect(() => parseTermixSqliteDatabase(database)).toThrow(
			'SQLite import did not include a supported Termix host table.'
		);
	});

	it('ignores malformed or unsupported sqlite_master rows before selecting host tables', () => {
		const database = createSqliteDatabaseFromSchemaRows([
			['index', 'hosts_idx', 'hosts', 2, 'CREATE INDEX hosts_idx ON hosts (id)'],
			['table', null, 'hosts', 2, 'CREATE TABLE hosts ("id" TEXT)'],
			['table', 'hosts', 'hosts', null, 'CREATE TABLE hosts ("id" TEXT)'],
			['table', 'hosts', 'hosts', 2, null],
			['table', 'sqlite_stat1', 'sqlite_stat1', 2, 'CREATE TABLE sqlite_stat1 ("tbl" TEXT)'],
			['table', 'connections', 'connections', 2, 'CREATE TABLE connections ()']
		]);

		expect(() => parseTermixSqliteDatabase(database)).toThrow(
			'SQLite import did not include a supported Termix host table.'
		);
	});

	it('rejects SQLite files with unsupported declared page sizes', () => {
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port'],
				rows: [['router', 'Lab router', 'telnet', 'router.lab', 23]]
			}
		]);
		database[16] = 0x00;
		database[17] = 0x03;

		expect(() => parseTermixSqliteDatabase(database)).toThrow('SQLite page size is not supported.');
	});

	it.each([
		['zero', 0],
		['too small', 256],
		['odd', 513]
	])('rejects %s SQLite page-size headers', (_label, headerPageSize) => {
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port'],
				rows: [['router', 'Lab router', 'telnet', 'router.lab', 23]]
			}
		]);
		database.writeUInt16BE(headerPageSize, 16);

		expect(() => parseTermixSqliteDatabase(database)).toThrow('SQLite page size is not supported.');
	});

	it('accepts the SQLite 65536-byte page-size sentinel', () => {
		const database = createSqliteDatabase(
			[
				{
					name: 'hosts',
					columns: ['id', 'name', 'connection_type', 'host', 'port'],
					rows: [['large-page', 'Large page host', 'ssh', 'large-page.example.test', 22]]
				}
			],
			{ pageSize: 65536, headerPageSize: 1 }
		);

		expect(parseTermixSqliteDatabase(database)[0]).toMatchObject({
			id: 'large-page',
			hostname: 'large-page.example.test'
		});
	});

	it('reports schema references that point beyond the available pages', () => {
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port'],
				rows: [['truncated', 'Truncated host', 'ssh', 'truncated.example.test', 22]]
			}
		]).slice(0, pageSize);

		expect(() => parseTermixSqliteDatabase(database)).toThrow(
			'SQLite file ended before a referenced page.'
		);
	});

	it('reports a truncated varint when a leaf cell starts at the page boundary', () => {
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port'],
				rows: [['boundary', 'Boundary host', 'ssh', 'boundary.example.test', 22]]
			}
		]);
		const pageStart = pageSize;
		database.writeUInt16BE(pageSize - 1, pageStart + 8);
		database[pageStart + pageSize - 1] = 0x80;

		expect(() => parseTermixSqliteDatabase(database)).toThrow('SQLite varint is truncated.');
	});

	it('reports a cell payload that crosses the page boundary without leaking secrets', () => {
		const secret = 'payload-secret-that-must-not-leak';
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port', 'password'],
				rows: [['payload', 'Payload host', 'ssh', 'payload.example.test', 22, secret]]
			}
		]);
		const cellOffset = readFirstCellOffset(database, 2, 0);
		database[pageSize + cellOffset] = 0x7f;

		const message = parseErrorMessage(database);

		expect(message).toContain('SQLite cell payload is truncated.');
		expect(message).not.toContain(secret);
	});

	it('reads overflow payloads that continue onto overflow pages', () => {
		const longNotes = 'overflow-notes-'.repeat(40);
		const database = createSqliteDatabaseWithOverflowRow([
			'overflow',
			'Overflow host',
			'ssh',
			'overflow.example.test',
			22,
			longNotes
		]);

		const records = parseTermixSqliteDatabase(database);
		const mapped = mapTermixRecords(records);

		expect(records[0]).toMatchObject({
			id: 'overflow',
			hostname: 'overflow.example.test',
			notes: longNotes
		});
		expect(mapped.hosts[0]).toMatchObject({
			hostname: 'overflow.example.test',
			notes: longNotes
		});
	});

	it('reports incomplete overflow chains without leaking row secrets', () => {
		const secret = 'overflow-secret-that-must-not-leak';
		const database = createSqliteDatabaseWithOverflowRow([
			'incomplete-overflow',
			'Incomplete overflow',
			'ssh',
			'overflow.example.test',
			22,
			secret.repeat(20)
		]);
		const overflowPointerOffset = findOverflowPointerOffset(database, 512, 2, 0);
		database.writeUInt32BE(0, overflowPointerOffset);

		const message = parseErrorMessage(database);

		expect(message).toContain('SQLite cell payload overflow chain is incomplete.');
		expect(message).not.toContain(secret);
	});

	it('reports corrupt SQLite pages as validation errors', () => {
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port'],
				rows: [['router', 'Lab router', 'telnet', 'router.lab', 23]]
			}
		]);

		database[pageSize + 8] = 0xff;
		database[pageSize + 9] = 0xff;

		expect(() => parseTermixSqliteDatabase(database)).toThrow('SQLite');
	});

	it('plugs into parseImportUpload with sqlite source kind', () => {
		const database = createSqliteDatabase([
			{
				name: 'hosts',
				columns: ['id', 'name', 'connection_type', 'host', 'port'],
				rows: [['router', 'Lab router', 'telnet', 'router.lab', 23]]
			}
		]);

		expect(parseImportUpload({ fileName: 'termix.db', bytes: database })).toMatchObject({
			sourceKind: 'sqlite',
			records: [
				{
					id: 'router',
					name: 'Lab router',
					connectionType: 'telnet',
					hostname: 'router.lab',
					port: 23
				}
			]
		});
	});
});

type FixtureTable = {
	name: string;
	columns: string[];
	rows: Array<Array<null | number | string>>;
};

const pageSize = 4096;

function createSqliteDatabase(
	tables: FixtureTable[],
	options: { pageSize?: number; headerPageSize?: number } = {}
): Buffer {
	const sqlitePageSize = options.pageSize ?? pageSize;
	const pageCount = 1 + tables.length;
	const database = Buffer.alloc(sqlitePageSize * pageCount);

	writeSqliteHeader(database, sqlitePageSize, pageCount, options.headerPageSize);

	const schemaRows = tables.map((table, index) => {
		const rootPage = index + 2;
		const sql = `CREATE TABLE ${table.name} (${table.columns
			.map((column) => `"${column}" TEXT`)
			.join(', ')})`;
		return ['table', table.name, table.name, rootPage, sql] satisfies Array<number | string>;
	});

	writeLeafTablePage(database, sqlitePageSize, 1, 100, schemaRows);
	tables.forEach((table, index) => {
		writeLeafTablePage(database, sqlitePageSize, index + 2, 0, table.rows);
	});

	return database;
}

function createSqliteDatabaseFromSchemaRows(
	schemaRows: Array<Array<null | number | string>>
): Buffer {
	const database = Buffer.alloc(pageSize);
	writeSqliteHeader(database, pageSize, 1);
	writeLeafTablePage(database, pageSize, 1, 100, schemaRows);
	return database;
}

function createSqliteDatabaseWithOverflowRow(row: Array<null | number | string>): Buffer {
	const sqlitePageSize = 512;
	const database = Buffer.alloc(sqlitePageSize * 3);
	const columns = ['id', 'name', 'connection_type', 'host', 'port', 'notes'];
	const schemaRows = [
		[
			'table',
			'hosts',
			'hosts',
			2,
			`CREATE TABLE hosts (${columns.map((column) => `"${column}" TEXT`).join(', ')})`
		]
	] satisfies Array<Array<number | string>>;

	writeSqliteHeader(database, sqlitePageSize, 3);
	writeLeafTablePage(database, sqlitePageSize, 1, 100, schemaRows);
	writeOverflowLeafTablePage(database, sqlitePageSize, 2, 3, row);

	return database;
}

function writeSqliteHeader(
	database: Buffer,
	sqlitePageSize: number,
	pageCount: number,
	headerPageSize = sqlitePageSize
): void {
	database.write('SQLite format 3\0', 0, 'binary');
	database.writeUInt16BE(headerPageSize, 16);
	database[18] = 1;
	database[19] = 1;
	database[20] = 0;
	database.writeUInt32BE(pageCount, 28);
	database.writeUInt32BE(1, 56);
}

function writeLeafTablePage(
	database: Buffer,
	sqlitePageSize: number,
	pageNumber: number,
	headerOffset: number,
	rows: Array<Array<null | number | string>>
): void {
	const pageStart = (pageNumber - 1) * sqlitePageSize;
	const page = database.subarray(pageStart, pageStart + sqlitePageSize);
	const cells = rows.map((row, index) =>
		Buffer.concat([
			encodeVarint(encodeRecord(row).byteLength),
			encodeVarint(index + 1),
			encodeRecord(row)
		])
	);
	let contentOffset = sqlitePageSize;

	page[headerOffset] = 0x0d;
	page.writeUInt16BE(0, headerOffset + 1);
	page.writeUInt16BE(cells.length, headerOffset + 3);
	page[headerOffset + 7] = 0;

	for (let index = 0; index < cells.length; index += 1) {
		const cell = cells[index] ?? Buffer.alloc(0);
		contentOffset -= cell.byteLength;
		cell.copy(page, contentOffset);
		page.writeUInt16BE(contentOffset, headerOffset + 8 + index * 2);
	}

	page.writeUInt16BE(contentOffset, headerOffset + 5);
}

function writeOverflowLeafTablePage(
	database: Buffer,
	sqlitePageSize: number,
	pageNumber: number,
	overflowPageNumber: number,
	row: Array<null | number | string>
): void {
	const payload = encodeRecord(row);
	const localSize = sqliteLocalPayloadSize(sqlitePageSize, payload.byteLength);
	const remaining = payload.byteLength - localSize;
	if (remaining <= 0 || remaining > sqlitePageSize - 4) {
		throw new Error('overflow fixture row must require exactly one overflow page');
	}

	const pointer = Buffer.alloc(4);
	pointer.writeUInt32BE(overflowPageNumber, 0);
	const cell = Buffer.concat([
		encodeVarint(payload.byteLength),
		encodeVarint(1),
		payload.subarray(0, localSize),
		pointer
	]);
	const pageStart = (pageNumber - 1) * sqlitePageSize;
	const page = database.subarray(pageStart, pageStart + sqlitePageSize);
	const contentOffset = sqlitePageSize - cell.byteLength;

	page[0] = 0x0d;
	page.writeUInt16BE(0, 1);
	page.writeUInt16BE(1, 3);
	page.writeUInt16BE(contentOffset, 5);
	page[7] = 0;
	page.writeUInt16BE(contentOffset, 8);
	cell.copy(page, contentOffset);

	const overflowStart = (overflowPageNumber - 1) * sqlitePageSize;
	const overflow = database.subarray(overflowStart, overflowStart + sqlitePageSize);
	overflow.writeUInt32BE(0, 0);
	payload.copy(overflow, 4, localSize);
}

function encodeRecord(values: Array<null | number | string>): Buffer {
	const fields = values.map(encodeField);
	const serialTypes = Buffer.concat(fields.map((field) => encodeVarint(field.serialType)));
	let headerSize = serialTypes.byteLength + 1;
	let encodedHeaderSize = encodeVarint(headerSize);

	while (encodedHeaderSize.byteLength + serialTypes.byteLength !== headerSize) {
		headerSize = encodedHeaderSize.byteLength + serialTypes.byteLength;
		encodedHeaderSize = encodeVarint(headerSize);
	}

	return Buffer.concat([encodedHeaderSize, serialTypes, ...fields.map((field) => field.value)]);
}

function encodeField(value: null | number | string): { serialType: number; value: Buffer } {
	if (value === null) return { serialType: 0, value: Buffer.alloc(0) };
	if (typeof value === 'number') {
		if (value === 0) return { serialType: 8, value: Buffer.alloc(0) };
		if (value === 1) return { serialType: 9, value: Buffer.alloc(0) };
		const buffer = Buffer.alloc(4);
		buffer.writeInt32BE(value, 0);
		return { serialType: 4, value: buffer };
	}

	const buffer = Buffer.from(value, 'utf8');
	return { serialType: 13 + buffer.byteLength * 2, value: buffer };
}

function encodeVarint(input: number): Buffer {
	if (input < 0) throw new Error('negative varints are not supported in fixtures');
	if (input <= 0x7f) return Buffer.from([input]);

	const bytes: number[] = [];
	let value = input;
	while (value > 0) {
		bytes.unshift(value & 0x7f);
		value >>= 7;
	}

	return Buffer.from(bytes.map((byte, index) => (index === bytes.length - 1 ? byte : byte | 0x80)));
}

function readFirstCellOffset(
	database: Buffer,
	pageNumber: number,
	headerOffset: number,
	sqlitePageSize = pageSize
): number {
	const pageStart = (pageNumber - 1) * sqlitePageSize;
	return database.readUInt16BE(pageStart + headerOffset + 8);
}

function findOverflowPointerOffset(
	database: Buffer,
	sqlitePageSize: number,
	pageNumber: number,
	headerOffset: number
): number {
	const pageStart = (pageNumber - 1) * sqlitePageSize;
	const cellOffset = readFirstCellOffset(database, pageNumber, headerOffset, sqlitePageSize);
	const payloadSize = readFixtureVarint(database, pageStart + cellOffset);
	const rowId = readFixtureVarint(database, payloadSize.nextOffset);
	return rowId.nextOffset + sqliteLocalPayloadSize(sqlitePageSize, payloadSize.value);
}

function readFixtureVarint(
	bytes: Uint8Array,
	offset: number
): { value: number; nextOffset: number } {
	let value = 0;

	for (let index = 0; index < 9; index += 1) {
		const byte = bytes[offset + index];
		if (byte === undefined) throw new Error('fixture varint is truncated');
		if (index === 8) return { value: value * 256 + byte, nextOffset: offset + 9 };

		value = value * 128 + (byte & 0x7f);
		if ((byte & 0x80) === 0) return { value, nextOffset: offset + index + 1 };
	}

	throw new Error('fixture varint is invalid');
}

function sqliteLocalPayloadSize(sqlitePageSize: number, payloadSize: number): number {
	const maxLocal = sqlitePageSize - 35;
	if (payloadSize <= maxLocal) return payloadSize;

	const minLocal = Math.floor(((sqlitePageSize - 12) * 32) / 255) - 23;
	const surplus = minLocal + ((payloadSize - minLocal) % (sqlitePageSize - 4));
	return surplus <= maxLocal ? surplus : minLocal;
}

function parseErrorMessage(database: Uint8Array): string {
	try {
		parseTermixSqliteDatabase(database);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}

	throw new Error('Expected SQLite parsing to fail');
}
