import { createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import type { ImportMappingOptions, ImportWarning } from './termix';

export type SourceSecretValue = string | Record<string, unknown>;

const AES_256_GCM_KEY_BYTES = 32;

type TermixEncryptedField = {
	data: string;
	iv: string;
	tag: string;
	salt: string;
	recordId?: string;
};

export function firstResolvedSecret(
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

export function resolveSecretValue(
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
