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

	it('redacts normalized sensitive metadata keys from nested returned records', async () => {
		expect.assertions(4);

		const repository = new InMemoryTermixServicesRepository();
		const credentials = new CredentialService(repository, {
			encrypt(plaintext, context) {
				return {
					ciphertext: `encrypted:${plaintext}`,
					metadata: {
						algorithm: 'aes-256-gcm',
						keyVersion: 1,
						iv: 'iv',
						authTag: 'auth-tag',
						salt: JSON.stringify(context)
					}
				};
			},
			decrypt(secret) {
				return secret.ciphertext.replace(/^encrypted:/, '');
			}
		});

		const created = await credentials.create('user-1', {
			name: 'API token',
			kind: 'password',
			username: 'deploy',
			secret: 'credential-secret',
			metadata: {
				label: 'safe-label',
				'api-key': 'metadata-api-key',
				access_token: 'metadata-access-token',
				nested: {
					'refresh token': 'metadata-refresh-token',
					notes: ['safe-note', { private_key: 'metadata-private-key', visible: 'safe' }]
				}
			}
		});

		expect(created.metadata).toEqual({
			label: 'safe-label',
			nested: {
				notes: ['safe-note', { visible: 'safe' }]
			}
		});
		await expect(credentials.get('user-1', created.id)).resolves.toMatchObject({
			metadata: created.metadata
		});
		await expect(credentials.list('user-1')).resolves.toMatchObject([
			{ id: created.id, metadata: created.metadata }
		]);
		expect(JSON.stringify(created)).not.toContain('metadata-api-key');
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
			name: 'ops password renamed',
			username: 'shell'
		});
		const [storedAfterMetadataEdit] = await repository.listCredentials('user-1');

		expect(updated).toMatchObject({
			name: 'ops password renamed',
			kind: 'password',
			username: 'shell'
		});
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
		expect(storedAfterRotation?.name).toBe('ops password renamed');
		expect(storedAfterRotation?.kind).toBe('password');
	});

	it('requires a replacement secret when changing credential kind', async () => {
		expect.assertions(3);

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

		await expect(
			credentials.update('user-1', created.id, {
				kind: 'ssh_key'
			})
		).rejects.toMatchObject({
			issues: ['secret is required when kind changes']
		});

		const [storedAfter] = await repository.listCredentials('user-1');
		expect(storedAfter?.kind).toBe('password');
		expect(storedAfter?.encryptedSecret).toBe(storedBefore?.encryptedSecret);
	});

	it('rotates secrets and strips kind-specific sensitive metadata when changing kind', async () => {
		expect.assertions(8);

		const repository = new InMemoryTermixServicesRepository();
		const crypto = new AesGcmCredentialCrypto('test-master-key');
		const credentials = new CredentialService(repository, crypto);

		const created = await credentials.create('user-1', {
			name: 'ops ssh',
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
		const [storedBefore] = await repository.listCredentials('user-1');

		const updated = await credentials.update('user-1', created.id, {
			kind: 'password',
			secret: 'rotated-password'
		});
		const [storedAfter] = await repository.listCredentials('user-1');

		expect(updated).toMatchObject({ kind: 'password' });
		expect(updated).not.toHaveProperty('encryptedSecret');
		expect(storedAfter?.encryptedSecret).not.toBe(storedBefore?.encryptedSecret);
		expect(
			crypto.decrypt(
				{
					ciphertext: storedAfter!.encryptedSecret,
					metadata: storedAfter!.encryption
				},
				credentialSecretContext('user-1', created.id)
			)
		).toBe('rotated-password');
		expect(storedAfter?.metadata).toEqual({
			sourceRecordId: 'source-1',
			nested: { label: 'safe' }
		});
		expect(storedAfter?.metadata.encryptedPassphrase).toBeUndefined();
		expect(storedAfter?.metadata.passphrase).toBeUndefined();
		expect(storedAfter?.metadata.password).toBeUndefined();
	});

	it('enforces workspace owner boundaries before persisting credential secrets', async () => {
		expect.assertions(4);

		const repository = new InMemoryTermixServicesRepository();
		const credentials = new CredentialService(repository, {
			encrypt(plaintext, context) {
				return {
					ciphertext: `encrypted:${plaintext}`,
					metadata: {
						algorithm: 'aes-256-gcm',
						keyVersion: 1,
						iv: 'iv',
						authTag: 'auth-tag',
						salt: JSON.stringify(context)
					}
				};
			},
			decrypt(secret) {
				return secret.ciphertext.replace(/^encrypted:/, '');
			}
		});
		const now = new Date('2026-05-14T12:00:00.000Z');
		await repository.createWorkspace({
			id: 'workspace-1',
			name: 'Ops',
			metadata: {},
			createdAt: now,
			updatedAt: now
		});
		await repository.createWorkspaceMembership({
			id: 'membership-owner',
			workspaceId: 'workspace-1',
			userId: 'owner-1',
			role: 'owner',
			createdAt: now,
			updatedAt: now
		});
		await repository.createWorkspaceMembership({
			id: 'membership-member',
			workspaceId: 'workspace-1',
			userId: 'member-1',
			role: 'member',
			createdAt: now,
			updatedAt: now
		});
		const shared = await credentials.create('owner-1', {
			workspaceId: 'workspace-1',
			name: 'Shared root',
			kind: 'password',
			secret: 'shared-secret'
		});

		await expect(
			credentials.create('member-1', {
				workspaceId: 'workspace-1',
				name: 'Member root',
				kind: 'password',
				secret: 'member-secret'
			})
		).rejects.toMatchObject({ issues: ['workspace owner role is required'] });
		await expect(
			credentials.update('member-1', shared.id, {
				workspaceId: 'workspace-1',
				name: 'Tampered root',
				kind: 'password',
				secret: 'tampered-secret'
			})
		).rejects.toMatchObject({ issues: ['workspace owner role is required'] });
		await expect(repository.listCredentials('member-1')).resolves.toEqual([
			expect.objectContaining({ id: shared.id, name: 'Shared root' })
		]);
		expect(JSON.stringify(await repository.listCredentials('owner-1'))).not.toContain(
			'member-secret'
		);
	});
});
