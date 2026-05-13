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
		expect(encrypted.metadata.iv).toBeTruthy();
		expect(decryptCredentialSecret(encrypted, { masterKey: 'test-master-key' })).toBe(
			'secret-password'
		);
	});

	it('binds ciphertext to credential owner and record context', () => {
		expect.assertions(3);

		const context = {
			userId: 'user-1',
			credentialId: 'credential-1',
			field: 'secret'
		};
		const encrypted = encryptCredentialSecret('secret-password', {
			masterKey: 'test-master-key',
			context
		});

		expect(encrypted.metadata.associatedData).toEqual({ version: 1, field: 'secret' });
		expect(decryptCredentialSecret(encrypted, { masterKey: 'test-master-key', context })).toBe(
			'secret-password'
		);
		expect(() =>
			decryptCredentialSecret(encrypted, {
				masterKey: 'test-master-key',
				context: { ...context, credentialId: 'credential-2' }
			})
		).toThrow();
	});

	it('rejects tampered ciphertext', () => {
		expect.assertions(1);

		const encrypted = encryptCredentialSecret('secret-password', { masterKey: 'test-master-key' });
		const tampered = Buffer.from(encrypted.ciphertext, 'base64url');
		tampered[0] ^= 1;

		expect(() =>
			decryptCredentialSecret(
				{ ...encrypted, ciphertext: tampered.toString('base64url') },
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
