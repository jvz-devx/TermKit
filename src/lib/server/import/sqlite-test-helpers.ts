import { parseTermixSqliteDatabase } from './sqlite';

export type FixtureTable = {
	name: string;
	columns: string[];
	rows: Array<Array<null | number | string>>;
};

export const pageSize = 4096;

export function createSqliteDatabase(
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

export function createSqliteDatabaseFromSchemaRows(
	schemaRows: Array<Array<null | number | string>>
): Buffer {
	const database = Buffer.alloc(pageSize);
	writeSqliteHeader(database, pageSize, 1);
	writeLeafTablePage(database, pageSize, 1, 100, schemaRows);
	return database;
}

export function createSqliteDatabaseWithOverflowRow(row: Array<null | number | string>): Buffer {
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

export function writeSqliteHeader(
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

export function writeLeafTablePage(
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

export function writeOverflowLeafTablePage(
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

export function encodeRecord(values: Array<null | number | string>): Buffer {
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

export function encodeField(value: null | number | string): { serialType: number; value: Buffer } {
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

export function encodeVarint(input: number): Buffer {
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

export function readFirstCellOffset(
	database: Buffer,
	pageNumber: number,
	headerOffset: number,
	sqlitePageSize = pageSize
): number {
	const pageStart = (pageNumber - 1) * sqlitePageSize;
	return database.readUInt16BE(pageStart + headerOffset + 8);
}

export function findOverflowPointerOffset(
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

export function readFixtureVarint(
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

export function sqliteLocalPayloadSize(sqlitePageSize: number, payloadSize: number): number {
	const maxLocal = sqlitePageSize - 35;
	if (payloadSize <= maxLocal) return payloadSize;

	const minLocal = Math.floor(((sqlitePageSize - 12) * 32) / 255) - 23;
	const surplus = minLocal + ((payloadSize - minLocal) % (sqlitePageSize - 4));
	return surplus <= maxLocal ? surplus : minLocal;
}

export function parseErrorMessage(database: Uint8Array): string {
	try {
		parseTermixSqliteDatabase(database);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}

	throw new Error('Expected SQLite parsing to fail');
}
