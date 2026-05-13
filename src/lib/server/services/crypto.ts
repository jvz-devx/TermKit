import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { decryptCredentialSecret, encryptCredentialSecret } from '$lib/server/crypto/credentials';
import type { CredentialCrypto, SecretCiphertext } from './types';

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export class AesGcmCredentialCrypto implements CredentialCrypto {
	constructor(private readonly masterKey = env.CREDENTIAL_MASTER_KEY) {}

	encrypt(plaintext: string): SecretCiphertext {
		return encryptCredentialSecret(plaintext, { masterKey: this.masterKey });
	}

	decrypt(secret: SecretCiphertext): string {
		return decryptCredentialSecret(secret, { masterKey: this.masterKey });
	}
}
