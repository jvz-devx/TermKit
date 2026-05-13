import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { CredentialCrypto, EncryptionMetadata, SecretCiphertext } from './types';

const algorithm = 'aes-256-gcm';
const keyVersion = 1;

function deriveKey(masterKey: string, salt: Buffer): Buffer {
	return pbkdf2Sync(masterKey, salt, 210_000, 32, 'sha256');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export class AesGcmCredentialCrypto implements CredentialCrypto {
	constructor(private readonly masterKey = env.CREDENTIAL_MASTER_KEY) {}

	encrypt(plaintext: string): SecretCiphertext {
		if (!this.masterKey) {
			throw new Error('CREDENTIAL_MASTER_KEY is not set');
		}

		const salt = randomBytes(16);
		const iv = randomBytes(12);
		const cipher = createCipheriv(algorithm, deriveKey(this.masterKey, salt), iv);
		const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
		const authTag = cipher.getAuthTag();

		return {
			ciphertext: ciphertext.toString('base64'),
			metadata: {
				algorithm,
				keyVersion,
				iv: iv.toString('base64'),
				authTag: authTag.toString('base64'),
				salt: salt.toString('base64')
			}
		};
	}

	decrypt(secret: SecretCiphertext): string {
		if (!this.masterKey) {
			throw new Error('CREDENTIAL_MASTER_KEY is not set');
		}

		const metadata = secret.metadata;
		assertSupportedMetadata(metadata);

		const decipher = createDecipheriv(
			algorithm,
			deriveKey(this.masterKey, Buffer.from(metadata.salt, 'base64')),
			Buffer.from(metadata.iv, 'base64')
		);
		decipher.setAuthTag(Buffer.from(metadata.authTag, 'base64'));

		return Buffer.concat([
			decipher.update(Buffer.from(secret.ciphertext, 'base64')),
			decipher.final()
		]).toString('utf8');
	}
}

function assertSupportedMetadata(metadata: EncryptionMetadata): void {
	if (metadata.algorithm !== algorithm || metadata.keyVersion !== keyVersion) {
		throw new Error('Unsupported credential encryption metadata');
	}
}
