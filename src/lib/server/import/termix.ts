import { createDecipheriv, createHash, hkdfSync } from 'node:crypto';

export type TermixSourceProtocol =
	| 'ssh'
	| 'rdp'
	| 'vnc'
	| 'telnet'
	| 'sftp'
	| 'ftp'
	| 'ftps'
	| 'guacamole'
	| string;

export type TermixSourceRecord = {
	id: string | number;
	name?: string | null;
	label?: string | null;
	protocol?: TermixSourceProtocol | null;
	connectionType?: TermixSourceProtocol | null;
	hostname?: string | null;
	host?: string | null;
	address?: string | null;
	ip?: string | null;
	port?: number | string | null;
	username?: string | null;
	user?: string | null;
	password?: SourceSecretValue | null;
	privateKey?: SourceSecretValue | null;
	sshKey?: SourceSecretValue | null;
	key?: SourceSecretValue | null;
	credentialSourceId?: string | number | null;
	credentialName?: string | null;
	credentialUsername?: string | null;
	domain?: string | null;
	folder?: string | null;
	tags?: string[] | string | null;
	notes?: string | null;
	snippetId?: string | number | null;
	guacamoleConfig?: Record<string, unknown> | null;
	serverStats?: unknown;
	raw?: Record<string, unknown>;
};

type SourceSecretValue = string | Record<string, unknown>;

export type ImportedHostProtocol = 'ssh' | 'rdp' | 'vnc' | 'telnet';
export type ImportedCredentialKind = 'password' | 'ssh_key';

export type ImportedHostDto = {
	sourceId: string;
	name: string;
	protocol: ImportedHostProtocol;
	hostname: string;
	port: number;
	username?: string;
	credentialRef?: string;
	folder?: string;
	tags: string[];
	notes?: string;
	metadata: Record<string, string>;
};

export type ImportedCredentialDto = {
	sourceId: string;
	name: string;
	kind: ImportedCredentialKind;
	username?: string;
	secret: string;
	metadata: Record<string, string>;
};

export type ImportWarning = {
	sourceId: string;
	code:
		| 'unsupported_protocol'
		| 'missing_hostname'
		| 'invalid_port'
		| 'unsupported_field'
		| 'credential_requires_decryption'
		| 'credential_decryption_failed'
		| 'unsupported_encrypted_credential';
	message: string;
};

export type ImportMappingOptions = {
	sourceSecret?: string;
};

export type ImportMappingResult = {
	hosts: ImportedHostDto[];
	credentials: ImportedCredentialDto[];
	warnings: ImportWarning[];
	summary: {
		createdHosts: number;
		createdCredentials: number;
		skippedRecords: number;
		warnings: number;
	};
};

const DEFAULT_PORT_BY_PROTOCOL = {
	ssh: 22,
	rdp: 3389,
	vnc: 5900,
	telnet: 23
} satisfies Record<ImportedHostProtocol, number>;

const SUPPORTED_PROTOCOLS = new Set<ImportedHostProtocol>(['ssh', 'rdp', 'vnc', 'telnet']);
const AES_256_GCM_KEY_BYTES = 32;

export function mapTermixRecords(
	records: TermixSourceRecord[],
	options: ImportMappingOptions = {}
): ImportMappingResult {
	const hosts: ImportedHostDto[] = [];
	const credentials: ImportedCredentialDto[] = [];
	const credentialSourceIds = new Set<string>();
	const warnings: ImportWarning[] = [];
	let skippedRecords = 0;

	for (const record of records) {
		const sourceId = String(record.id);
		const protocol = normalizeProtocol(record.protocol ?? record.connectionType);

		if (!protocol || !SUPPORTED_PROTOCOLS.has(protocol)) {
			warnings.push({
				sourceId,
				code: 'unsupported_protocol',
				message: `Record uses unsupported protocol "${record.protocol ?? record.connectionType ?? 'unknown'}".`
			});
			skippedRecords += 1;
			continue;
		}

		const hostname = firstPresent(record.hostname, record.host, record.address, record.ip);
		if (!hostname) {
			warnings.push({
				sourceId,
				code: 'missing_hostname',
				message: 'Record does not include a hostname or address.'
			});
			skippedRecords += 1;
			continue;
		}

		const port = parsePort(record.port, DEFAULT_PORT_BY_PROTOCOL[protocol]);
		if (port === undefined) {
			warnings.push({
				sourceId,
				code: 'invalid_port',
				message: `Record has an invalid port "${String(record.port)}".`
			});
			skippedRecords += 1;
			continue;
		}

		const username = firstPresent(record.username, record.user);
		const credential = mapCredential(record, sourceId, username, options, warnings);
		if (credential) {
			if (!credentialSourceIds.has(credential.sourceId)) {
				credentialSourceIds.add(credential.sourceId);
				credentials.push(credential);
			}
		}

		collectUnsupportedWarnings(record, sourceId, warnings);

		hosts.push({
			sourceId,
			name: recordDisplayName(record, sourceId, hostname),
			protocol,
			hostname,
			port,
			username: username || undefined,
			credentialRef: credential?.sourceId,
			folder: record.folder?.trim() || undefined,
			tags: normalizeTags(record.tags),
			notes: record.notes?.trim() || undefined,
			metadata: record.domain?.trim() ? { domain: record.domain.trim() } : {}
		});
	}

	return {
		hosts,
		credentials,
		warnings,
		summary: {
			createdHosts: hosts.length,
			createdCredentials: credentials.length,
			skippedRecords,
			warnings: warnings.length
		}
	};
}

function normalizeProtocol(protocol: TermixSourceProtocol | null | undefined) {
	const normalized = protocol?.toLowerCase().trim();
	if (normalized === 'sftp') return 'ssh';
	return normalized as ImportedHostProtocol | undefined;
}

function firstPresent(...values: Array<string | null | undefined>) {
	return values.map((value) => value?.trim()).find((value) => value && value.length > 0);
}

function parsePort(port: TermixSourceRecord['port'], fallback: number) {
	if (port === null || port === undefined || port === '') return fallback;

	const parsed = typeof port === 'number' ? port : Number.parseInt(port, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return undefined;

	return parsed;
}

function normalizeTags(tags: TermixSourceRecord['tags']) {
	if (!tags) return [];
	if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean);

	return tags
		.split(',')
		.map((tag) => tag.trim())
		.filter(Boolean);
}

function recordDisplayName(
	record: TermixSourceRecord,
	sourceId: string,
	hostname?: string
): string {
	return (
		firstPresent(
			record.name,
			record.label,
			hostname,
			record.hostname,
			record.host,
			record.address,
			record.ip
		) ?? sourceId
	);
}

function mapCredential(
	record: TermixSourceRecord,
	sourceId: string,
	username: string | undefined,
	options: ImportMappingOptions,
	warnings: ImportWarning[]
): ImportedCredentialDto | undefined {
	const privateKey = firstResolvedSecret(
		[
			{ fieldName: 'privateKey', value: record.privateKey },
			{ fieldName: 'key', value: record.key },
			{ fieldName: 'sshKey', value: record.sshKey }
		],
		sourceId,
		options,
		warnings
	);
	const credentialSourceId =
		firstPresent(String(record.credentialSourceId ?? ''), sourceId) ?? sourceId;
	const credentialUsername = firstPresent(record.credentialUsername, username);
	const metadata = credentialMetadata(sourceId, credentialSourceId);
	if (privateKey) {
		return {
			sourceId: `${credentialSourceId}:ssh-key`,
			name: firstPresent(record.credentialName) ?? `${recordDisplayName(record, sourceId)} SSH key`,
			kind: 'ssh_key',
			username: credentialUsername || undefined,
			secret: privateKey,
			metadata
		};
	}

	const password = resolveSecretValue(record.password, 'password', sourceId, options, warnings);
	if (!password) return undefined;

	return {
		sourceId: `${credentialSourceId}:password`,
		name: firstPresent(record.credentialName) ?? `${recordDisplayName(record, sourceId)} password`,
		kind: 'password',
		username: credentialUsername || undefined,
		secret: password,
		metadata
	};
}

function credentialMetadata(sourceId: string, credentialSourceId: string): Record<string, string> {
	return credentialSourceId === sourceId
		? { sourceRecordId: sourceId }
		: { sourceRecordId: sourceId, sourceCredentialId: credentialSourceId };
}

function firstResolvedSecret(
	fields: Array<{ fieldName: string; value: SourceSecretValue | null | undefined }>,
	sourceId: string,
	options: ImportMappingOptions,
	warnings: ImportWarning[]
): string | undefined {
	for (const field of fields) {
		const secret = resolveSecretValue(field.value, field.fieldName, sourceId, options, warnings);
		if (secret) return secret;
	}
	return undefined;
}

function resolveSecretValue(
	value: SourceSecretValue | null | undefined,
	fieldName: string,
	sourceId: string,
	options: ImportMappingOptions,
	warnings: ImportWarning[]
): string | undefined {
	if (value === null || value === undefined) return undefined;

	if (!isEncryptedSecretValue(value)) {
		return typeof value === 'string' ? value.trim() || undefined : undefined;
	}

	if (!options.sourceSecret?.trim()) {
		warnings.push({
			sourceId,
			code: 'credential_requires_decryption',
			message: `Encrypted ${fieldName} credential was not imported because a source decrypt secret was not provided.`
		});
		return undefined;
	}

	const encrypted = parseEncryptedSecret(value);
	if (!encrypted) {
		warnings.push({
			sourceId,
			code: 'unsupported_encrypted_credential',
			message: `Encrypted ${fieldName} credential was not imported because its JSON format is not supported.`
		});
		return undefined;
	}

	try {
		return decryptTermixFieldSecret(encrypted, options.sourceSecret, sourceId, fieldName);
	} catch {
		warnings.push({
			sourceId,
			code: 'credential_decryption_failed',
			message: `Encrypted ${fieldName} credential could not be decrypted with the supplied source secret.`
		});
		return undefined;
	}
}

type TermixEncryptedField = {
	data: string;
	iv: string;
	tag: string;
	salt: string;
	recordId?: string;
};

function isEncryptedSecretValue(value: SourceSecretValue): boolean {
	if (typeof value !== 'string') return isTermixEncryptedField(value);
	const trimmed = value.trim();
	return trimmed.startsWith('encrypted:') || isJsonEncryptedField(trimmed);
}

function parseEncryptedSecret(value: SourceSecretValue): TermixEncryptedField | null {
	if (typeof value !== 'string') return toTermixEncryptedField(value);

	const trimmed = value.trim();
	const payload = trimmed.startsWith('encrypted:') ? trimmed.slice('encrypted:'.length) : trimmed;
	return parseEncryptedPayload(payload) ?? parseEncryptedPayload(decodeBase64Text(payload));
}

function parseEncryptedPayload(payload: string | null): TermixEncryptedField | null {
	if (!payload) return null;

	const trimmed = payload.trim();
	if (!trimmed.startsWith('{')) return null;

	try {
		return toTermixEncryptedField(JSON.parse(trimmed));
	} catch {
		return null;
	}
}

function toTermixEncryptedField(value: unknown): TermixEncryptedField | null {
	if (!isRecord(value)) return null;
	if (!isTermixEncryptedField(value)) return null;

	return {
		data: value.data,
		iv: value.iv,
		tag: value.tag,
		salt: value.salt,
		recordId: typeof value.recordId === 'string' ? value.recordId : undefined
	};
}

function isTermixEncryptedField(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		typeof value.data === 'string' &&
		typeof value.iv === 'string' &&
		typeof value.tag === 'string' &&
		typeof value.salt === 'string'
	);
}

function isJsonEncryptedField(value: string): boolean {
	return parseEncryptedPayload(value) !== null;
}

function decryptTermixFieldSecret(
	encrypted: TermixEncryptedField,
	sourceSecret: string,
	sourceId: string,
	fieldName: string
): string {
	const key = sourceSecretToKey(sourceSecret);
	const recordIds = uniqueStrings([encrypted.recordId, sourceId]);
	let lastError: unknown;

	for (const recordId of recordIds) {
		try {
			const fieldKey = Buffer.from(
				hkdfSync(
					'sha256',
					key,
					Buffer.from(encrypted.salt, 'hex'),
					`${recordId}:${fieldName}`,
					AES_256_GCM_KEY_BYTES
				)
			);
			const decipher = createDecipheriv('aes-256-gcm', fieldKey, Buffer.from(encrypted.iv, 'hex'));
			decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
			return decipher.update(encrypted.data, 'hex', 'utf8') + decipher.final('utf8');
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError instanceof Error ? lastError : new Error('source credential decryption failed');
}

function sourceSecretToKey(sourceSecret: string): Buffer {
	const trimmed = sourceSecret.trim();

	if (/^[0-9a-f]{64}$/i.test(trimmed)) {
		return Buffer.from(trimmed, 'hex');
	}

	const base64 = decodeBase64Buffer(trimmed);
	if (base64?.length === AES_256_GCM_KEY_BYTES) return base64;

	const utf8 = Buffer.from(trimmed, 'utf8');
	if (utf8.length === AES_256_GCM_KEY_BYTES) return utf8;

	return createHash('sha256').update(trimmed).digest();
}

function decodeBase64Text(value: string): string | null {
	const decoded = decodeBase64Buffer(value);
	return decoded ? decoded.toString('utf8') : null;
}

function decodeBase64Buffer(value: string): Buffer | null {
	try {
		const decoded = Buffer.from(value, 'base64');
		if (decoded.length === 0) return null;
		return decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
			? decoded
			: null;
	} catch {
		return null;
	}
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectUnsupportedWarnings(
	record: TermixSourceRecord,
	sourceId: string,
	warnings: ImportWarning[]
) {
	if (record.guacamoleConfig && Object.keys(record.guacamoleConfig).length > 0) {
		warnings.push({
			sourceId,
			code: 'unsupported_field',
			message: 'Guacamole-specific configuration was ignored.'
		});
	}

	if (record.snippetId !== null && record.snippetId !== undefined) {
		warnings.push({
			sourceId,
			code: 'unsupported_field',
			message: 'Snippet reference was ignored.'
		});
	}

	if (record.serverStats !== null && record.serverStats !== undefined) {
		warnings.push({
			sourceId,
			code: 'unsupported_field',
			message: 'Server statistics were ignored.'
		});
	}
}
