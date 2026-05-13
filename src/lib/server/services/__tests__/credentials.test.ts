import { describe, expect, it } from 'vitest';
import { AesGcmCredentialCrypto } from '../crypto';
import {
	CredentialService,
	credentialPassphraseContext,
	credentialSecretContext
} from '../credentials';
import { InMemoryTermixServicesRepository } from '../repository';
import type { EncryptionMetadata } from '../types';

describe('CredentialService', () => {
	it('encrypts secrets with owner and record context and redacts sensitive metadata', async () => {
		expect.assertions(12);

		const repository = new InMemoryTermixServicesRepository();
		const crypto = new AesGcmCredentialCrypto('test-master-key');
		const credentials = new CredentialService(repository, crypto);

		const created = await credentials.create('user-1', {
			name: 'SSH key',
			kind: 'ssh_key',
			username: 'shell',
			secret: 'private-key',
			metadata: {
				passphrase: 'key-passphrase',
				password: 'metadata-password',
				sourceRecordId: 'source-1',
				nested: { token: 'metadata-token', label: 'safe' }
			}
		});

		expect(created).not.toHaveProperty('encryptedSecret');
		expect(created).not.toHaveProperty('encryption');
		expect(created.metadata).toEqual({
			sourceRecordId: 'source-1',
			nested: { label: 'safe' }
		});

		const [stored] = await repository.listCredentials('user-1');
		expect(stored).toBeDefined();
		expect(stored?.encryptedSecret).not.toBe('private-key');
		expect(stored?.encryption.associatedData).toEqual({ version: 1, field: 'secret' });
		expect(
			crypto.decrypt(
				{ ciphertext: stored!.encryptedSecret, metadata: stored!.encryption },
				credentialSecretContext('user-1', stored!.id)
			)
		).toBe('private-key');
		expect(stored?.metadata.passphrase).toBeUndefined();
		expect(stored?.metadata.password).toBeUndefined();
		expect(stored?.metadata.encryptedPassphrase).toMatchObject({
			ciphertext: expect.any(String),
			encryption: expect.objectContaining({
				associatedData: { version: 1, field: 'metadata.passphrase' }
			})
		});

		const encryptedPassphrase = stored!.metadata.encryptedPassphrase as {
			ciphertext: string;
			encryption: EncryptionMetadata;
		};
		expect(
			crypto.decrypt(
				{
					ciphertext: encryptedPassphrase.ciphertext,
					metadata: encryptedPassphrase.encryption
				},
				credentialPassphraseContext('user-1', stored!.id)
			)
		).toBe('key-passphrase');
		expect(() =>
			crypto.decrypt(
				{ ciphertext: stored!.encryptedSecret, metadata: stored!.encryption },
				credentialSecretContext('user-2', stored!.id)
			)
		).toThrow();
	});
});
