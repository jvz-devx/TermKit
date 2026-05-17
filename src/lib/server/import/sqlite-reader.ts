import { ServiceValidationError } from '$lib/server/services/errors';

export type SqliteValue = null | number | string | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;

export type SqliteTable = {
	name: string;
	rootPage: number;
	sql: string;
	columns: string[];
};

type SchemaRow = {
	type?: SqliteValue;
	name?: SqliteValue;
	tbl_name?: SqliteValue;
	rootpage?: SqliteValue;
	sql?: SqliteValue;
};

const SQLITE_HEADER = 'SQLite format 3\0';

export function isSqliteBuffer(bytes: Uint8Array): boolean {
	if (bytes.byteLength < SQLITE_HEADER.length) return false;
	return Buffer.from(bytes.slice(0, SQLITE_HEADER.length)).toString('binary') === SQLITE_HEADER;
}

export class SqliteDatabase {
	private readonly bytes: Uint8Array;
	private readonly pageSize: number;
	private readonly reservedBytes: number;
	private readonly usablePageSize: number;
	private readonly textEncoding: BufferEncoding;

	constructor(bytes: Uint8Array) {
		if (!isSqliteBuffer(bytes)) {
			throw new ServiceValidationError(['SQLite file header is invalid.']);
		}

		this.bytes = bytes;
		const declaredPageSize = readUint16(bytes, 16);
		this.pageSize = declaredPageSize === 1 ? 65536 : declaredPageSize;
		this.reservedBytes = bytes[20] ?? 0;
		this.usablePageSize = this.pageSize - this.reservedBytes;
		this.textEncoding = sqliteTextEncoding(readUint32(bytes, 56));

		if (this.pageSize < 512 || this.pageSize > 65536 || this.pageSize % 2 !== 0) {
			throw new ServiceValidationError(['SQLite page size is not supported.']);
		}
	}

	readSchema(): SqliteTable[] {
		const rows = this.readTableRows(1, [
			'type',
			'name',
			'tbl_name',
			'rootpage',
			'sql'
		]) as SchemaRow[];
		return rows
			.filter((row) => row.type === 'table' && typeof row.name === 'string')
			.filter((row) => typeof row.sql === 'string' && typeof row.rootpage === 'number')
			.filter((row) => !String(row.name).startsWith('sqlite_'))
			.map((row) => {
				const name = String(row.name).toLowerCase();
				const sql = String(row.sql);
				return {
					name,
					rootPage: Number(row.rootpage),
					sql,
					columns: parseCreateTableColumns(sql)
				};
			})
			.filter((table) => table.columns.length > 0 && table.rootPage > 0);
	}

	readTable(table: SqliteTable): SqliteRow[] {
		return this.readTableRows(table.rootPage, table.columns);
	}

	private readTableRows(rootPage: number, columns: string[]): SqliteRow[] {
		const rows: SqliteRow[] = [];
		this.walkTableBtree(rootPage, columns, rows, new Set());
		return rows;
	}

	private walkTableBtree(
		pageNumber: number,
		columns: string[],
		rows: SqliteRow[],
		visitedPages: Set<number>
	): void {
		if (visitedPages.has(pageNumber)) return;
		visitedPages.add(pageNumber);

		const page = this.page(pageNumber);
		const headerOffset = pageNumber === 1 ? 100 : 0;
		if (headerOffset + 8 > page.length) {
			throw new ServiceValidationError(['SQLite b-tree page header is truncated.']);
		}

		const type = page[headerOffset];
		const cellCount = readUint16(page, headerOffset + 3);
		const cellPointerOffset = headerOffset + (type === 0x05 ? 12 : 8);
		const cellPointerEnd = cellPointerOffset + cellCount * 2;
		if (cellPointerEnd > page.length) {
			throw new ServiceValidationError(['SQLite b-tree cell pointer array is truncated.']);
		}

		if (type === 0x0d) {
			for (let index = 0; index < cellCount; index += 1) {
				const cellOffset = readUint16(page, cellPointerOffset + index * 2);
				assertPageRange(page, cellOffset, 1, 'SQLite table leaf cell points outside its page.');
				rows.push(this.readTableLeafCell(pageNumber, page, cellOffset, columns));
			}
			return;
		}

		if (type === 0x05) {
			if (headerOffset + 12 > page.length) {
				throw new ServiceValidationError(['SQLite interior b-tree page header is truncated.']);
			}

			for (let index = 0; index < cellCount; index += 1) {
				const cellOffset = readUint16(page, cellPointerOffset + index * 2);
				assertPageRange(page, cellOffset, 4, 'SQLite interior table cell is truncated.');
				const leftChildPage = readUint32(page, cellOffset);
				this.walkTableBtree(leftChildPage, columns, rows, visitedPages);
			}
			this.walkTableBtree(readUint32(page, headerOffset + 8), columns, rows, visitedPages);
			return;
		}

		throw new ServiceValidationError(['SQLite table uses an unsupported b-tree page type.']);
	}

	private readTableLeafCell(
		pageNumber: number,
		page: Uint8Array,
		cellOffset: number,
		columns: string[]
	): SqliteRow {
		const payloadSize = readVarint(page, cellOffset);
		const rowId = readVarint(page, payloadSize.nextOffset);
		const payloadOffset = rowId.nextOffset;
		const payload = this.readPayload(pageNumber, page, payloadOffset, Number(payloadSize.value));
		const values = readRecordPayload(payload, this.textEncoding);
		const row: SqliteRow = { rowid: toSqliteNumber(rowId.value) };

		for (let index = 0; index < columns.length; index += 1) {
			row[columns[index] ?? `column_${index}`] = values[index] ?? null;
		}

		return row;
	}

	private readPayload(
		pageNumber: number,
		page: Uint8Array,
		payloadOffset: number,
		payloadSize: number
	): Uint8Array {
		const localSize = this.localPayloadSize(payloadSize);
		assertPageRange(page, payloadOffset, localSize, 'SQLite cell payload is truncated.');
		const localPayload = page.slice(payloadOffset, payloadOffset + localSize);

		if (localSize === payloadSize) return localPayload;

		const overflowPointerOffset = payloadOffset + localSize;
		assertPageRange(page, overflowPointerOffset, 4, 'SQLite cell overflow pointer is truncated.');
		let nextOverflowPage = readUint32(page, overflowPointerOffset);
		const chunks = [localPayload];
		let remaining = payloadSize - localSize;
		const visitedPages = new Set([pageNumber]);

		while (remaining > 0 && nextOverflowPage > 0) {
			if (visitedPages.has(nextOverflowPage)) {
				throw new ServiceValidationError(['SQLite overflow page cycle detected.']);
			}
			visitedPages.add(nextOverflowPage);

			const overflow = this.page(nextOverflowPage);
			nextOverflowPage = readUint32(overflow, 0);
			const chunkSize = Math.min(remaining, this.usablePageSize - 4);
			chunks.push(overflow.slice(4, 4 + chunkSize));
			remaining -= chunkSize;
		}

		if (remaining > 0) {
			throw new ServiceValidationError(['SQLite cell payload overflow chain is incomplete.']);
		}

		return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
	}

	private localPayloadSize(payloadSize: number): number {
		const maxLocal = this.usablePageSize - 35;
		if (payloadSize <= maxLocal) return payloadSize;

		const minLocal = Math.floor(((this.usablePageSize - 12) * 32) / 255) - 23;
		const surplus = minLocal + ((payloadSize - minLocal) % (this.usablePageSize - 4));
		return surplus <= maxLocal ? surplus : minLocal;
	}

	private page(pageNumber: number): Uint8Array {
		if (pageNumber < 1) throw new ServiceValidationError(['SQLite page number is invalid.']);

		const start = (pageNumber - 1) * this.pageSize;
		const end = start + this.pageSize;
		if (end > this.bytes.byteLength) {
			throw new ServiceValidationError(['SQLite file ended before a referenced page.']);
		}

		return this.bytes.slice(start, end);
	}
}

function readRecordPayload(payload: Uint8Array, textEncoding: BufferEncoding): SqliteValue[] {
	const headerSize = readVarint(payload, 0);
	if (Number(headerSize.value) > payload.length) {
		throw new ServiceValidationError(['SQLite record header is truncated.']);
	}
	const serialTypes: bigint[] = [];
	let offset = headerSize.nextOffset;

	while (offset < Number(headerSize.value)) {
		const serialType = readVarint(payload, offset);
		serialTypes.push(serialType.value);
		offset = serialType.nextOffset;
	}

	let bodyOffset = Number(headerSize.value);
	return serialTypes.map((serialType) => {
		const value = readSerialValue(payload, bodyOffset, serialType, textEncoding);
		bodyOffset += value.byteLength;
		return value.value;
	});
}

function readSerialValue(
	payload: Uint8Array,
	offset: number,
	serialType: bigint,
	textEncoding: BufferEncoding
): { value: SqliteValue; byteLength: number } {
	const type = Number(serialType);
	switch (type) {
		case 0:
			return { value: null, byteLength: 0 };
		case 1:
			assertPageRange(payload, offset, 1, 'SQLite record value is truncated.');
			return { value: readSignedInteger(payload, offset, 1), byteLength: 1 };
		case 2:
			assertPageRange(payload, offset, 2, 'SQLite record value is truncated.');
			return { value: readSignedInteger(payload, offset, 2), byteLength: 2 };
		case 3:
			assertPageRange(payload, offset, 3, 'SQLite record value is truncated.');
			return { value: readSignedInteger(payload, offset, 3), byteLength: 3 };
		case 4:
			assertPageRange(payload, offset, 4, 'SQLite record value is truncated.');
			return { value: readSignedInteger(payload, offset, 4), byteLength: 4 };
		case 5:
			assertPageRange(payload, offset, 6, 'SQLite record value is truncated.');
			return { value: readSignedInteger(payload, offset, 6), byteLength: 6 };
		case 6:
			assertPageRange(payload, offset, 8, 'SQLite record value is truncated.');
			return { value: readSignedInteger(payload, offset, 8), byteLength: 8 };
		case 7:
			assertPageRange(payload, offset, 8, 'SQLite record value is truncated.');
			return {
				value: Buffer.from(payload.slice(offset, offset + 8)).readDoubleBE(0),
				byteLength: 8
			};
		case 8:
			return { value: 0, byteLength: 0 };
		case 9:
			return { value: 1, byteLength: 0 };
		default: {
			if (type < 12) return { value: null, byteLength: 0 };
			const byteLength = type % 2 === 0 ? (type - 12) / 2 : (type - 13) / 2;
			assertPageRange(payload, offset, byteLength, 'SQLite record value is truncated.');
			const bytes = payload.slice(offset, offset + byteLength);
			if (type % 2 === 0) return { value: bytes, byteLength };
			return { value: Buffer.from(bytes).toString(textEncoding), byteLength };
		}
	}
}

function parseCreateTableColumns(sql: string): string[] {
	const start = sql.indexOf('(');
	const end = sql.lastIndexOf(')');
	if (start === -1 || end === -1 || end <= start) return [];

	return splitSqlList(sql.slice(start + 1, end))
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => part.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/)?.[1] ?? '')
		.map(unquoteIdentifier)
		.filter((name) => name && !isTableConstraint(name))
		.map((name) => name.toLowerCase());
}

function splitSqlList(value: string): string[] {
	const parts: string[] = [];
	let current = '';
	let quote: string | null = null;
	let depth = 0;

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index] ?? '';
		const next = value[index + 1];

		if (quote) {
			current += char;
			if (char === quote) {
				if (next === quote) {
					current += next;
					index += 1;
				} else {
					quote = null;
				}
			}
			continue;
		}

		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			current += char;
			continue;
		}
		if (char === '(') depth += 1;
		if (char === ')') depth -= 1;

		if (char === ',' && depth === 0) {
			parts.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	parts.push(current);
	return parts;
}

function unquoteIdentifier(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith('`') && trimmed.endsWith('`')) ||
		(trimmed.startsWith('[') && trimmed.endsWith(']'))
	) {
		return trimmed.slice(1, -1).replace(/""/g, '"');
	}
	return trimmed.toLowerCase();
}

function isTableConstraint(name: string): boolean {
	return ['constraint', 'primary', 'foreign', 'unique', 'check'].includes(name.toLowerCase());
}

function sqliteTextEncoding(value: number): BufferEncoding {
	if (value === 2) return 'utf16le';
	return 'utf8';
}

function readVarint(bytes: Uint8Array, offset: number): { value: bigint; nextOffset: number } {
	let value = 0n;

	for (let index = 0; index < 9; index += 1) {
		const byte = bytes[offset + index];
		if (byte === undefined) throw new ServiceValidationError(['SQLite varint is truncated.']);

		if (index === 8) {
			return { value: (value << 8n) | BigInt(byte), nextOffset: offset + 9 };
		}

		value = (value << 7n) | BigInt(byte & 0x7f);
		if ((byte & 0x80) === 0) return { value, nextOffset: offset + index + 1 };
	}

	throw new ServiceValidationError(['SQLite varint is invalid.']);
}

function readSignedInteger(bytes: Uint8Array, offset: number, byteLength: number): number {
	let value = 0n;
	for (let index = 0; index < byteLength; index += 1) {
		value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
	}

	const signBit = 1n << BigInt(byteLength * 8 - 1);
	if ((value & signBit) !== 0n) value -= 1n << BigInt(byteLength * 8);
	return toSqliteNumber(value);
}

function toSqliteNumber(value: bigint): number {
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER;
}

function assertPageRange(page: Uint8Array, offset: number, length: number, message: string): void {
	if (!Number.isInteger(offset) || offset < 0 || offset + length > page.length) {
		throw new ServiceValidationError([message]);
	}
}

function readUint16(bytes: Uint8Array, offset: number): number {
	assertPageRange(bytes, offset, 2, 'SQLite file is truncated.');
	return Buffer.from(bytes.buffer, bytes.byteOffset + offset, 2).readUInt16BE(0);
}

function readUint32(bytes: Uint8Array, offset: number): number {
	assertPageRange(bytes, offset, 4, 'SQLite file is truncated.');
	return Buffer.from(bytes.buffer, bytes.byteOffset + offset, 4).readUInt32BE(0);
}
