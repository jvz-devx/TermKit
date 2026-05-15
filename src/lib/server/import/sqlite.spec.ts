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

function createSqliteDatabase(tables: FixtureTable[]): Uint8Array {
	const pageCount = 1 + tables.length;
	const database = Buffer.alloc(pageSize * pageCount);

	database.write('SQLite format 3\0', 0, 'binary');
	database.writeUInt16BE(pageSize, 16);
	database[18] = 1;
	database[19] = 1;
	database[20] = 0;
	database.writeUInt32BE(pageCount, 28);
	database.writeUInt32BE(1, 56);

	const schemaRows = tables.map((table, index) => {
		const rootPage = index + 2;
		const sql = `CREATE TABLE ${table.name} (${table.columns
			.map((column) => `"${column}" TEXT`)
			.join(', ')})`;
		return ['table', table.name, table.name, rootPage, sql] satisfies Array<number | string>;
	});

	writeLeafTablePage(database, 1, 100, schemaRows);
	tables.forEach((table, index) => {
		writeLeafTablePage(database, index + 2, 0, table.rows);
	});

	return database;
}

function writeLeafTablePage(
	database: Buffer,
	pageNumber: number,
	headerOffset: number,
	rows: Array<Array<null | number | string>>
): void {
	const pageStart = (pageNumber - 1) * pageSize;
	const page = database.subarray(pageStart, pageStart + pageSize);
	const cells = rows.map((row, index) =>
		Buffer.concat([
			encodeVarint(encodeRecord(row).byteLength),
			encodeVarint(index + 1),
			encodeRecord(row)
		])
	);
	let contentOffset = pageSize;

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
