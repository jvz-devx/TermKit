import { describe, expect, it } from 'vitest';
import { CredentialService } from '$lib/server/services/credentials';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { ServiceValidationError } from '$lib/server/services/errors';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { SessionTicketTargetSnapshot } from '$lib/server/services/session-tickets';
import type { CredentialRecord } from '$lib/server/services/types';
import { resolveRdpLaunchCredentials } from './rdp-credentials';

describe('RDP launch credentials', () => {
	it('returns host username without a password when no credential is bound', async () => {
		const credentials = await resolveRdpLaunchCredentials(
			'user-1',
			testTargetSnapshot({ username: 'host-user', credentialId: null }),
			new InMemoryTermixServicesRepository(),
			new AesGcmCredentialCrypto('rdp-test-master-key')
		);

		expect(credentials).toEqual({
			username: 'host-user',
			password: null,
			source: 'none',
			unavailableReason: null
		});
	});

	it('decrypts saved password credentials for RDP launch authentication', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'rdp-password'
		});

		const credentials = await resolveRdpLaunchCredentials(
			'user-1',
			testTargetSnapshot({ username: 'host-user', credentialId: credential.id }),
			repository,
			crypto
		);

		expect(credential.encryptedSecret).not.toBe('rdp-password');
		expect(credentials).toEqual({
			username: 'credential-user',
			password: 'rdp-password',
			source: 'saved-password',
			unavailableReason: null
		});
	});

	it('falls back to the host username when a saved password has no username', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'rdp-password',
			username: null
		});

		const credentials = await resolveRdpLaunchCredentials(
			'user-1',
			testTargetSnapshot({ username: 'host-user', credentialId: credential.id }),
			repository,
			crypto
		);

		expect(credentials.username).toBe('host-user');
		expect(credentials.password).toBe('rdp-password');
		expect(credentials.source).toBe('saved-password');
		expect(credentials.unavailableReason).toBeNull();
	});

	it('rejects SSH key credentials because RDP launch requires passwords', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'ssh_key',
			secret: 'private-key'
		});

		await expect(
			resolveRdpLaunchCredentials(
				'user-1',
				testTargetSnapshot({ credentialId: credential.id }),
				repository,
				crypto
			)
		).rejects.toMatchObject({
			issues: ['RDP saved credential must be a password credential']
		});
	});

	it('rejects a launch snapshot whose saved credential no longer exists', async () => {
		await expect(
			resolveRdpLaunchCredentials(
				'user-1',
				testTargetSnapshot({ credentialId: 'missing-credential' }),
				new InMemoryTermixServicesRepository(),
				new AesGcmCredentialCrypto('rdp-test-master-key')
			)
		).rejects.toMatchObject({
			issues: ['RDP credential is unavailable']
		});
	});
});

async function createEncryptedCredential(input: {
	kind: 'password' | 'ssh_key';
	secret: string;
	username?: string | null;
}): Promise<{
	repository: InMemoryTermixServicesRepository;
	crypto: AesGcmCredentialCrypto;
	credential: CredentialRecord;
}> {
	const repository = new InMemoryTermixServicesRepository();
	const crypto = new AesGcmCredentialCrypto('rdp-test-master-key');
	const service = new CredentialService(repository, crypto);
	const created = await service.create('user-1', {
		name: 'RDP credential',
		kind: input.kind,
		username: input.username === undefined ? 'credential-user' : input.username,
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
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389,
			username: null,
			credentialId: null,
			metadata: {},
			...patch
		},
		credential: null
	};
}
