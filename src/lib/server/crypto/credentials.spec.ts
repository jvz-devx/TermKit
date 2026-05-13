import { describe, expect, it } from 'vitest';
import {
	CredentialEncryptionError,
	decryptCredentialSecret,
	encryptCredentialSecret
} from './credentials';

describe('credential encryption', () => {
	it('round-trips credential plaintext with authenticated metadata', () => {
		expect.assertions(5);

		const encrypted = encryptCredentialSecret('secret-password', {
			masterKey: 'test-master-key',
			keyVersion: 7
		});

		expect(encrypted.ciphertext).not.toBe('secret-password');
		expect(encrypted.metadata.algorithm).toBe('aes-256-gcm');
		expect(encrypted.metadata.keyVersion).toBe(7);
		expect(encrypted.metadata.nonce).toBeTruthy();
		expect(decryptCredentialSecret(encrypted, { masterKey: 'test-master-key' })).toBe(
			'secret-password'
		);
	});

	it('rejects tampered ciphertext', () => {
		expect.assertions(1);

		const encrypted = encryptCredentialSecret('secret-password', { masterKey: 'test-master-key' });

		expect(() =>
			decryptCredentialSecret(
				{ ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}A` },
				{ masterKey: 'test-master-key' }
			)
		).toThrow();
	});

	it('requires a master key', () => {
		expect.assertions(1);

		expect(() => encryptCredentialSecret('secret-password', { masterKey: '' })).toThrow(
			CredentialEncryptionError
		);
	});
});
