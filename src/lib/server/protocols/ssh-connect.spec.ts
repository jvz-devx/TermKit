import { describe, expect, it } from 'vitest';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { ServiceValidationError } from '$lib/server/services/errors';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { HostRecord } from '$lib/server/services/types';
import { _resolveJumpHostTarget, type SshConnectTarget } from './ssh-connect';

describe('SSH jump-host target resolution', () => {
	it('requires an explicit jump host target', async () => {
		await expect(_resolveJumpHostTarget(target())).rejects.toMatchObject({
			issues: ['SSH jump host is required']
		});
	});

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

	it('resolves jump hosts with host usernames and keeps nested jump metadata', async () => {
		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(
			host({
				id: 'jump-1',
				username: 'bastion-host-user',
				hostname: 'jump.example.test',
				metadata: { sshJumpHost: { enabled: true, hostId: 'outer-jump' } }
			})
		);

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), { repository })
		).resolves.toMatchObject({
			userId: 'user-1',
			hostId: 'jump-1',
			host: 'jump.example.test',
			port: 22,
			username: 'bastion-host-user',
			credential: undefined,
			jumpHost: { hostId: 'outer-jump' }
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

	it('rejects missing jump hosts, missing credentials, and username-less jump hosts', async () => {
		const missing = new InMemoryTermixServicesRepository();

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), { repository: missing })
		).rejects.toMatchObject({ message: 'SSH jump host not found' });

		const missingCredential = new InMemoryTermixServicesRepository();
		await missingCredential.createHost(host({ id: 'jump-1', credentialId: 'credential-404' }));

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), {
				repository: missingCredential
			})
		).rejects.toMatchObject({ message: 'SSH jump credential not found' });

		const missingUsername = new InMemoryTermixServicesRepository();
		await missingUsername.createHost(host({ id: 'jump-1' }));

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), {
				repository: missingUsername
			})
		).rejects.toMatchObject({ issues: ['SSH jump host username is required'] });
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
