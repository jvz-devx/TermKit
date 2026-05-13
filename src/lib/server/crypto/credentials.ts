import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const algorithm = 'aes-256-gcm';
const info = 'termixkit:credential-encryption:v1';
const associatedDataInfo = 'termixkit:credential-encryption:aad:v1';
const minimumProductionMasterKeyBytes = 32;

export type CredentialEncryptionContext = {
	userId: string;
	credentialId: string;
	field: string;
};

export type CredentialEncryptionMetadata = {
	algorithm: typeof algorithm;
	keyVersion: number;
	iv: string;
	authTag: string;
	salt: string;
	associatedData?: {
		version: 1;
		field: string;
	};
};

export type EncryptedCredential = {
	ciphertext: string;
	metadata: CredentialEncryptionMetadata;
};

export class CredentialEncryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CredentialEncryptionError';
	}
}

export function validateCredentialMasterKey(
	masterKey: string | undefined,
	options: { production?: boolean } = {}
): string {
	if (!masterKey) {
		throw new CredentialEncryptionError('CREDENTIAL_MASTER_KEY is not set');
	}

	if (options.production && !isStrongProductionMasterKey(masterKey)) {
		throw new CredentialEncryptionError(
			'CREDENTIAL_MASTER_KEY must be at least 32 bytes and high-entropy in production'
		);
	}

	return masterKey;
}

export function getCredentialKeyVersion(): number {
	const raw = env.CREDENTIAL_MASTER_KEY_VERSION ?? '1';
	const keyVersion = Number.parseInt(raw, 10);

	if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
		throw new CredentialEncryptionError('CREDENTIAL_MASTER_KEY_VERSION must be a positive integer');
	}

	return keyVersion;
}

function getMasterKey(masterKey = env.CREDENTIAL_MASTER_KEY): Buffer {
	return Buffer.from(
		validateCredentialMasterKey(masterKey, { production: process.env.NODE_ENV === 'production' }),
		'utf8'
	);
}

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
	return Buffer.from(hkdfSync('sha256', masterKey, salt, info, 32));
}

export function encryptCredentialSecret(
	plaintext: string,
	options: { masterKey?: string; keyVersion?: number; context?: CredentialEncryptionContext } = {}
): EncryptedCredential {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = deriveKey(getMasterKey(options.masterKey), salt);
	const cipher = createCipheriv(algorithm, key, iv);

	if (options.context) {
		cipher.setAAD(credentialAssociatedData(options.context));
	}

	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

	return {
		ciphertext: ciphertext.toString('base64url'),
		metadata: {
			algorithm,
			keyVersion: options.keyVersion ?? getCredentialKeyVersion(),
			iv: iv.toString('base64url'),
			authTag: cipher.getAuthTag().toString('base64url'),
			salt: salt.toString('base64url'),
			associatedData: options.context
				? {
						version: 1,
						field: options.context.field
					}
				: undefined
		}
	};
}

export function decryptCredentialSecret(
	encrypted: EncryptedCredential,
	options: { masterKey?: string; context?: CredentialEncryptionContext } = {}
): string {
	if (encrypted.metadata.algorithm !== algorithm) {
		throw new CredentialEncryptionError('Unsupported credential encryption algorithm');
	}

	if (encrypted.metadata.associatedData && !options.context) {
		throw new CredentialEncryptionError('Credential encryption context is required');
	}

	if (
		encrypted.metadata.associatedData &&
		options.context &&
		encrypted.metadata.associatedData.field !== options.context.field
	) {
		throw new CredentialEncryptionError('Credential encryption context does not match metadata');
	}

	const salt = Buffer.from(encrypted.metadata.salt, 'base64url');
	const iv = Buffer.from(encrypted.metadata.iv, 'base64url');
	const authTag = Buffer.from(encrypted.metadata.authTag, 'base64url');
	const key = deriveKey(getMasterKey(options.masterKey), salt);
	const decipher = createDecipheriv(algorithm, key, iv);

	if (encrypted.metadata.associatedData && options.context) {
		decipher.setAAD(credentialAssociatedData(options.context));
	}

	decipher.setAuthTag(authTag);

	try {
		return Buffer.concat([
			decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
			decipher.final()
		]).toString('utf8');
	} catch {
		throw new CredentialEncryptionError(
			'Credential secret could not be decrypted; verify CREDENTIAL_MASTER_KEY, encryption context, and stored metadata'
		);
	}
}

function isStrongProductionMasterKey(masterKey: string): boolean {
	if (Buffer.byteLength(masterKey, 'utf8') < minimumProductionMasterKeyBytes) return false;
	if (masterKey.trim() !== masterKey) return false;

	const lower = masterKey.toLowerCase();
	if (
		[
			'change-me',
			'changeme',
			'credential-master-key',
			'development',
			'password',
			'secret',
			'test-master-key',
			'termixkit'
		].some((placeholder) => lower.includes(placeholder))
	) {
		return false;
	}

	if (new Set(masterKey).size < 8) return false;
	return !isRepeatedPattern(masterKey);
}

function isRepeatedPattern(value: string): boolean {
	for (let size = 1; size <= 8 && size <= value.length / 2; size += 1) {
		if (value.length % size === 0 && value.slice(0, size).repeat(value.length / size) === value) {
			return true;
		}
	}

	return false;
}

function credentialAssociatedData(context: CredentialEncryptionContext): Buffer {
	return Buffer.from(
		JSON.stringify({
			info: associatedDataInfo,
			userId: context.userId,
			credentialId: context.credentialId,
			field: context.field
		}),
		'utf8'
	);
}
