import { describe, expect, it } from 'vitest';
import { CredentialService } from '../credentials';
import type { CredentialCrypto, SecretCiphertext } from '../types';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { WorkspaceService } from '../workspaces';

const crypto: CredentialCrypto = {
	encrypt(plaintext): SecretCiphertext {
		return {
			ciphertext: `encrypted:${plaintext}`,
			metadata: {
				algorithm: 'aes-256-gcm',
				keyVersion: 1,
				iv: 'iv',
				authTag: 'auth-tag',
				salt: 'salt'
			}
		};
	},
	decrypt(secret): string {
		return secret.ciphertext.replace(/^encrypted:/, '');
	}
};

describe('WorkspaceService', () => {
	it('creates owner memberships and limits member management to owners', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const service = new WorkspaceService(repository);

		const workspace = await service.create('owner-1', { name: ' Team Ops ' });
		await expect(service.list('owner-1')).resolves.toMatchObject([{ id: workspace.id }]);
		await expect(service.listMembers('owner-1', workspace.id)).resolves.toMatchObject([
			{ workspaceId: workspace.id, userId: 'owner-1', role: 'owner' }
		]);

		const member = await service.addMember('owner-1', workspace.id, {
			userId: 'member-1',
			role: 'member'
		});
		expect(member).toMatchObject({
			workspaceId: workspace.id,
			userId: 'member-1',
			role: 'member'
		});
		await expect(
			service.addMember('member-1', workspace.id, { userId: 'member-2' })
		).rejects.toMatchObject({ issues: ['workspace owner role is required'] });
	});

	it('lets owners rename workspaces and remove other members', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const service = new WorkspaceService(repository);

		const workspace = await service.create('owner-1', { name: 'Ops' });
		await service.addMember('owner-1', workspace.id, { userId: 'member-1' });

		await expect(
			service.rename('owner-1', workspace.id, { name: 'Production' })
		).resolves.toMatchObject({
			id: workspace.id,
			name: 'Production'
		});
		await expect(
			service.removeMember('owner-1', workspace.id, 'member-1')
		).resolves.toBeUndefined();
		await expect(service.listMembers('owner-1', workspace.id)).resolves.toMatchObject([
			{ userId: 'owner-1', role: 'owner' }
		]);
		await expect(service.removeMember('owner-1', workspace.id, 'owner-1')).rejects.toMatchObject({
			issues: ['workspace owners cannot remove their own membership']
		});
	});
});

describe('workspace scoped hosts and credentials', () => {
	it('exposes workspace resources to members without leaking private resources', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const workspaces = new WorkspaceService(repository);
		const credentials = new CredentialService(repository, crypto);
		const hosts = new HostService(repository);

		const workspace = await workspaces.create('owner-1', { name: 'Ops' });
		await workspaces.addMember('owner-1', workspace.id, { userId: 'member-1' });
		const sharedCredential = await credentials.create('owner-1', {
			workspaceId: workspace.id,
			name: 'Shared root',
			kind: 'password',
			username: 'root',
			secret: 'password'
		});
		await credentials.create('owner-1', {
			name: 'Private root',
			kind: 'password',
			username: 'root',
			secret: 'password'
		});

		const sharedHost = await hosts.create('owner-1', {
			workspaceId: workspace.id,
			name: 'Shared SSH',
			protocol: 'ssh',
			hostname: 'shared.example.test',
			port: 22,
			credentialId: sharedCredential.id
		});

		await expect(hosts.list('member-1')).resolves.toMatchObject([
			{ id: sharedHost.id, workspaceId: workspace.id }
		]);
		await expect(credentials.list('member-1')).resolves.toMatchObject([
			{ id: sharedCredential.id, workspaceId: workspace.id }
		]);
		await expect(
			hosts.create('member-1', {
				workspaceId: workspace.id,
				name: 'Member SSH',
				protocol: 'ssh',
				hostname: 'member.example.test',
				port: 22
			})
		).rejects.toMatchObject({
			issues: ['workspace owner role is required']
		});
		await expect(
			hosts.update('member-1', sharedHost.id, {
				workspaceId: workspace.id,
				name: 'Mutated SSH',
				protocol: 'ssh',
				hostname: 'shared.example.test',
				port: 22,
				credentialId: sharedCredential.id
			})
		).rejects.toMatchObject({
			issues: ['workspace owner role is required']
		});
		await expect(hosts.delete('member-1', sharedHost.id)).rejects.toMatchObject({
			issues: ['workspace owner role is required']
		});
		await expect(
			credentials.update('member-1', sharedCredential.id, {
				workspaceId: workspace.id,
				name: 'Mutated root',
				kind: 'password',
				username: 'root'
			})
		).rejects.toMatchObject({
			issues: ['workspace owner role is required']
		});
		await expect(credentials.delete('member-1', sharedCredential.id)).rejects.toMatchObject({
			issues: ['workspace owner role is required']
		});
		await expect(
			hosts.create('member-2', {
				workspaceId: workspace.id,
				name: 'Denied SSH',
				protocol: 'ssh',
				hostname: 'denied.example.test',
				port: 22
			})
		).rejects.toMatchObject({
			issues: ['workspaceId must reference a workspace the user belongs to']
		});
	});

	it('requires host credentials to belong to the same private or workspace scope', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const workspaces = new WorkspaceService(repository);
		const credentials = new CredentialService(repository, crypto);
		const hosts = new HostService(repository);
		const workspace = await workspaces.create('owner-1', { name: 'Ops' });
		const privateCredential = await credentials.create('owner-1', {
			name: 'Private root',
			kind: 'password',
			secret: 'password'
		});

		await expect(
			hosts.create('owner-1', {
				workspaceId: workspace.id,
				name: 'Shared SSH',
				protocol: 'ssh',
				hostname: 'shared.example.test',
				port: 22,
				credentialId: privateCredential.id
			})
		).rejects.toMatchObject({
			issues: ['credentialId must belong to the same scope as the host']
		});
	});
});
