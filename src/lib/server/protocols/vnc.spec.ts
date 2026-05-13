import { describe, expect, it } from 'vitest';
import { ServiceValidationError } from '$lib/server/services/errors';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { CredentialRecord } from '$lib/server/services/types';
import type { SessionTicketTargetSnapshot } from '$lib/server/services/session-tickets';
import { resolveVncLaunchCredentials } from './vnc';

describe('VNC launch credentials', () => {
	it('returns host username without a password when no credential is bound', async () => {
		const credentials = await resolveVncLaunchCredentials(
			'user-1',
			testTargetSnapshot({ username: 'host-user', credentialId: null }),
			new InMemoryTermixServicesRepository(),
			new AesGcmCredentialCrypto('vnc-test-master-key')
		);

		expect(credentials).toEqual({
			username: 'host-user',
			password: null,
			source: 'none',
			unavailableReason: null
		});
	});

	it('decrypts saved password credentials for noVNC browser authentication', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'vnc-password'
		});

		const credentials = await resolveVncLaunchCredentials(
			'user-1',
			testTargetSnapshot({ username: 'host-user', credentialId: credential.id }),
			repository,
			crypto
		);

		expect(credential.encryptedSecret).not.toBe('vnc-password');
		expect(credentials).toEqual({
			username: 'credential-user',
			password: 'vnc-password',
			source: 'saved-password',
			unavailableReason: null
		});
	});

	it('rejects non-password credentials because noVNC cannot use SSH keys', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'ssh_key',
			secret: 'private-key'
		});

		await expect(
			resolveVncLaunchCredentials(
				'user-1',
				testTargetSnapshot({ credentialId: credential.id }),
				repository,
				crypto
			)
		).rejects.toMatchObject({
			issues: ['VNC saved credential must be a password credential']
		});
	});
});

async function createEncryptedCredential(input: {
	kind: 'password' | 'ssh_key';
	secret: string;
}): Promise<{
	repository: InMemoryTermixServicesRepository;
	crypto: AesGcmCredentialCrypto;
	credential: CredentialRecord;
}> {
	const repository = new InMemoryTermixServicesRepository();
	const crypto = new AesGcmCredentialCrypto('vnc-test-master-key');
	const service = new CredentialService(repository, crypto);
	const created = await service.create('user-1', {
		name: 'VNC credential',
		kind: input.kind,
		username: 'credential-user',
		secret: input.secret
	});
	const credential = await repository.getCredential('user-1', created.id);

	if (!credential) throw new ServiceValidationError(['test credential was not stored']);
	return { repository, crypto, credential };
}

function testTargetSnapshot(
	patch: Partial<SessionTicketTargetSnapshot['host']> = {}
): SessionTicketTargetSnapshot {
	return {
		version: 1,
		host: {
			id: 'host-1',
			protocol: 'vnc',
			hostname: 'desktop.example.test',
			port: 5900,
			username: null,
			credentialId: null,
			metadata: {},
			...patch
		},
		credential: null
	};
}
