import { describe, expect, it } from 'vitest';
import { ServiceValidationError } from '$lib/server/services/errors';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { CredentialRecord, HostRecord } from '$lib/server/services/types';
import { deleteSftpPath, resolveSftpTarget, validateSftpPath } from './sftp';

describe('SFTP path validation', () => {
	it('normalizes absolute remote paths', () => {
		expect(validateSftpPath('/srv/app//logs/')).toBe('/srv/app/logs');
	});

	it('rejects relative and traversal paths', () => {
		expect(() => validateSftpPath('srv/app')).toThrow(ServiceValidationError);
		expect(() => validateSftpPath('/srv/../etc/passwd')).toThrow(ServiceValidationError);
	});

	it('rejects NUL bytes', () => {
		expect(() => validateSftpPath('/srv/app\0secret')).toThrow(ServiceValidationError);
	});

	it('does not allow deleting the remote filesystem root', async () => {
		await expect(
			deleteSftpPath(
				{ userId: 'user-1', hostId: 'host-1', host: 'example.test', port: 22, username: 'ops' },
				'/'
			)
		).rejects.toMatchObject({
			issues: ['path cannot be the filesystem root']
		});
	});
});

describe('SFTP target resolution', () => {
	it('decrypts saved password credentials with credential AAD context', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password'
		});
		await repository.createHost(testHost({ credentialId: credential.id, username: null }));

		const target = await resolveSftpTarget('user-1', 'host-1', repository, crypto);

		expect(credential.encryptedSecret).not.toBe('saved-password');
		expect(credential.encryption.associatedData).toEqual({ version: 1, field: 'secret' });
		expect(target).toEqual({
			userId: 'user-1',
			hostId: 'host-1',
			host: 'shell.example.test',
			port: 22,
			username: 'credential-user',
			credential: {
				kind: 'password',
				username: 'credential-user',
				password: 'saved-password'
			}
		});
	});

	it('decrypts saved SSH key passphrases with credential metadata AAD context', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'ssh_key',
			secret: 'private-key',
			metadata: { passphrase: 'key-passphrase' }
		});
		await repository.createHost(testHost({ credentialId: credential.id, username: 'host-user' }));

		const target = await resolveSftpTarget('user-1', 'host-1', repository, crypto);

		expect(credential.metadata.passphrase).toBeUndefined();
		expect(credential.metadata.encryptedPassphrase).toMatchObject({
			ciphertext: expect.any(String),
			encryption: expect.objectContaining({
				associatedData: { version: 1, field: 'metadata.passphrase' }
			})
		});
		expect(target).toEqual({
			userId: 'user-1',
			hostId: 'host-1',
			host: 'shell.example.test',
			port: 22,
			username: 'credential-user',
			credential: {
				kind: 'ssh_key',
				username: 'credential-user',
				privateKey: 'private-key',
				passphrase: 'key-passphrase'
			}
		});
	});
});

async function createEncryptedCredential(input: {
	kind: 'password' | 'ssh_key';
	secret: string;
	metadata?: Record<string, unknown>;
}): Promise<{
	repository: InMemoryTermixServicesRepository;
	crypto: AesGcmCredentialCrypto;
	credential: CredentialRecord;
}> {
	const repository = new InMemoryTermixServicesRepository();
	const crypto = new AesGcmCredentialCrypto('sftp-test-master-key');
	const service = new CredentialService(repository, crypto);
	const created = await service.create('user-1', {
		name: 'SFTP credential',
		kind: input.kind,
		username: 'credential-user',
		secret: input.secret,
		metadata: input.metadata
	});
	const credential = await repository.getCredential('user-1', created.id);

	if (!credential) throw new Error('test credential was not stored');
	return { repository, crypto, credential };
}

function testHost(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date();
	return {
		id: 'host-1',
		userId: 'user-1',
		name: 'Shell',
		protocol: 'ssh',
		hostname: 'shell.example.test',
		port: 22,
		username: null,
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		createdAt: now,
		updatedAt: now,
		...patch
	};
}
