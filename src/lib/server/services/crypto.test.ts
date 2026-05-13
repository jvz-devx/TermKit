import { describe, expect, it } from 'vitest';
import { decryptCredentialSecret } from '$lib/server/crypto/credentials';
import { AesGcmCredentialCrypto } from './crypto';

describe('AesGcmCredentialCrypto', () => {
	it('uses the shared credential encryption metadata shape', () => {
		expect.assertions(3);

		const crypto = new AesGcmCredentialCrypto('test-master-key');
		const encrypted = crypto.encrypt('secret-password');

		expect(encrypted.metadata).toMatchObject({
			algorithm: 'aes-256-gcm',
			iv: expect.any(String),
			authTag: expect.any(String),
			salt: expect.any(String)
		});
		expect(crypto.decrypt(encrypted)).toBe('secret-password');
		expect(decryptCredentialSecret(encrypted, { masterKey: 'test-master-key' })).toBe(
			'secret-password'
		);
	});
});
