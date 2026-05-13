import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const algorithm = 'aes-256-gcm';
const info = 'termixkit:credential-encryption:v1';

export type CredentialEncryptionMetadata = {
	algorithm: typeof algorithm;
	keyVersion: number;
	iv: string;
	authTag: string;
	salt: string;
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

export function getCredentialKeyVersion(): number {
	const raw = env.CREDENTIAL_MASTER_KEY_VERSION ?? '1';
	const keyVersion = Number.parseInt(raw, 10);

	if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
		throw new CredentialEncryptionError('CREDENTIAL_MASTER_KEY_VERSION must be a positive integer');
	}

	return keyVersion;
}

function getMasterKey(masterKey = env.CREDENTIAL_MASTER_KEY): Buffer {
	if (!masterKey) {
		throw new CredentialEncryptionError('CREDENTIAL_MASTER_KEY is not set');
	}

	return Buffer.from(masterKey, 'utf8');
}

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
	return Buffer.from(hkdfSync('sha256', masterKey, salt, info, 32));
}

export function encryptCredentialSecret(
	plaintext: string,
	options: { masterKey?: string; keyVersion?: number } = {}
): EncryptedCredential {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = deriveKey(getMasterKey(options.masterKey), salt);
	const cipher = createCipheriv(algorithm, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

	return {
		ciphertext: ciphertext.toString('base64url'),
		metadata: {
			algorithm,
			keyVersion: options.keyVersion ?? getCredentialKeyVersion(),
			iv: iv.toString('base64url'),
			authTag: cipher.getAuthTag().toString('base64url'),
			salt: salt.toString('base64url')
		}
	};
}

export function decryptCredentialSecret(
	encrypted: EncryptedCredential,
	options: { masterKey?: string } = {}
): string {
	if (encrypted.metadata.algorithm !== algorithm) {
		throw new CredentialEncryptionError('Unsupported credential encryption algorithm');
	}

	const salt = Buffer.from(encrypted.metadata.salt, 'base64url');
	const iv = Buffer.from(encrypted.metadata.iv, 'base64url');
	const authTag = Buffer.from(encrypted.metadata.authTag, 'base64url');
	const key = deriveKey(getMasterKey(options.masterKey), salt);
	const decipher = createDecipheriv(algorithm, key, iv);

	decipher.setAuthTag(authTag);

	return Buffer.concat([
		decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
		decipher.final()
	]).toString('utf8');
}
