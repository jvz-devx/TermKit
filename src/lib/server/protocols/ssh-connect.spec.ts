import { describe, expect, it } from 'vitest';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { ServiceValidationError } from '$lib/server/services/errors';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { HostRecord } from '$lib/server/services/types';
import { _resolveJumpHostTarget, type SshConnectTarget } from './ssh-connect';

describe('SSH jump-host target resolution', () => {
	it('resolves jump host credentials through the same credential model as final targets', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const crypto = new AesGcmCredentialCrypto('ssh-connect-test-key');
		const credentials = new CredentialService(repository, crypto);
		const credential = await credentials.create('user-1', {
			name: 'Jump key',
			kind: 'ssh_key',
			username: 'bastion-user',
			secret: 'private-key',
			metadata: { passphrase: 'jump-passphrase' }
		});
		await repository.createHost(
			host({
				id: 'jump-1',
				name: 'Bastion',
				hostname: 'jump.example.test',
				credentialId: credential.id
			})
		);

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), {
				repository,
				crypto
			})
		).resolves.toMatchObject({
			userId: 'user-1',
			hostId: 'jump-1',
			host: 'jump.example.test',
			port: 22,
			username: 'bastion-user',
			credential: {
				kind: 'ssh_key',
				username: 'bastion-user',
				privateKey: 'private-key',
				passphrase: 'jump-passphrase'
			}
		});
	});

	it('rejects non-SSH jump hosts before opening a connection', async () => {
		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(
			host({
				id: 'jump-1',
				protocol: 'rdp',
				name: 'Wrong protocol',
				hostname: 'windows.example.test',
				port: 3389,
				username: 'admin'
			})
		);

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), { repository })
		).rejects.toBeInstanceOf(ServiceValidationError);
	});
});

function target(patch: Partial<SshConnectTarget> = {}): SshConnectTarget {
	return {
		userId: 'user-1',
		hostId: 'target-1',
		host: 'target.example.test',
		port: 22,
		username: 'ops',
		...patch
	};
}

function host(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'host-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'SSH host',
		protocol: 'ssh',
		hostname: 'shell.example.test',
		port: 22,
		username: null,
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}
