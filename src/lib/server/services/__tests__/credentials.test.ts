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

	it('keeps credential secrets write-only during metadata edits and rotates them on replacement', async () => {
		expect.assertions(8);

		const repository = new InMemoryTermixServicesRepository();
		const crypto = new AesGcmCredentialCrypto('test-master-key');
		const credentials = new CredentialService(repository, crypto);

		const created = await credentials.create('user-1', {
			name: 'ops password',
			kind: 'password',
			username: 'ops',
			secret: 'initial-secret'
		});
		const [storedBefore] = await repository.listCredentials('user-1');

		const updated = await credentials.update('user-1', created.id, {
			name: 'ops ssh',
			kind: 'ssh_key',
			username: 'shell'
		});
		const [storedAfterMetadataEdit] = await repository.listCredentials('user-1');

		expect(updated).toMatchObject({ name: 'ops ssh', kind: 'ssh_key', username: 'shell' });
		expect(updated).not.toHaveProperty('encryptedSecret');
		expect(storedAfterMetadataEdit?.encryptedSecret).toBe(storedBefore?.encryptedSecret);
		expect(storedAfterMetadataEdit?.encryption).toEqual(storedBefore?.encryption);

		await credentials.update('user-1', created.id, { secret: 'rotated-secret' });
		const [storedAfterRotation] = await repository.listCredentials('user-1');

		expect(storedAfterRotation?.encryptedSecret).not.toBe(storedAfterMetadataEdit?.encryptedSecret);
		expect(
			crypto.decrypt(
				{
					ciphertext: storedAfterRotation!.encryptedSecret,
					metadata: storedAfterRotation!.encryption
				},
				credentialSecretContext('user-1', created.id)
			)
		).toBe('rotated-secret');
		expect(storedAfterRotation?.name).toBe('ops ssh');
		expect(storedAfterRotation?.kind).toBe('ssh_key');
	});
});
