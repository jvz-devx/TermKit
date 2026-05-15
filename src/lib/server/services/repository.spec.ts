import { describe, expect, it } from 'vitest';
import { InMemoryTermixServicesRepository } from './repository';
import type {
	ConnectionSessionRecord,
	CredentialRecord,
	HostRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from './types';

describe('InMemoryTermixServicesRepository filtering and mapping', () => {
	it('separates private rows from workspace-visible host and credential rows', async () => {
		expect.assertions(8);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createWorkspace(workspace({ id: 'workspace-1', name: 'Primary Ops' }));
		await repository.createWorkspace(workspace({ id: 'workspace-2', name: 'Other Ops' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'owner-member', workspaceId: 'workspace-1', userId: 'owner-1' })
		);
		await repository.createWorkspaceMembership(
			membership({ id: 'viewer-member', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createWorkspaceMembership(
			membership({ id: 'other-member', workspaceId: 'workspace-2', userId: 'other-1' })
		);
		await repository.createHost(host({ id: 'owner-private-host', userId: 'owner-1' }));
		await repository.createHost(host({ id: 'member-private-host', userId: 'member-1' }));
		await repository.createHost(
			host({ id: 'workspace-host', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createHost(
			host({ id: 'other-workspace-host', userId: 'other-1', workspaceId: 'workspace-2' })
		);
		await repository.createCredential(
			credential({ id: 'owner-private-credential', userId: 'owner-1' })
		);
		await repository.createCredential(
			credential({ id: 'workspace-credential', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createCredential(
			credential({
				id: 'other-workspace-credential',
				userId: 'other-1',
				workspaceId: 'workspace-2'
			})
		);

		await expect(repository.listHosts('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'member-private-host', workspaceId: null }),
			expect.objectContaining({
				id: 'workspace-host',
				userId: 'owner-1',
				workspaceId: 'workspace-1'
			})
		]);
		await expect(repository.listCredentials('member-1')).resolves.toEqual([
			expect.objectContaining({
				id: 'workspace-credential',
				userId: 'owner-1',
				workspaceId: 'workspace-1'
			})
		]);
		await expect(repository.getHost('member-1', 'owner-private-host')).resolves.toBeNull();
		await expect(
			repository.getCredential('member-1', 'owner-private-credential')
		).resolves.toBeNull();
		await expect(repository.getHost('member-1', 'other-workspace-host')).resolves.toBeNull();
		await expect(
			repository.getCredential('member-1', 'other-workspace-credential')
		).resolves.toBeNull();
		await expect(
			repository.updateHost('member-1', 'workspace-host', { name: 'Renamed shared host' })
		).resolves.toMatchObject({
			id: 'workspace-host',
			userId: 'owner-1',
			name: 'Renamed shared host'
		});
		await expect(
			repository.updateCredential('member-1', 'workspace-credential', {
				name: 'Renamed shared credential'
			})
		).resolves.toMatchObject({
			id: 'workspace-credential',
			userId: 'owner-1',
			name: 'Renamed shared credential'
		});
	});

	it('maps connection history details after filtering and orders newest sessions first', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createWorkspace(workspace({ id: 'workspace-1', name: 'Operations' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'membership-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createHost(
			host({
				id: 'workspace-host',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				name: 'Shared shell',
				hostname: 'shared.example.test',
				username: 'deploy'
			})
		);
		await repository.createConnectionSession(
			session({
				id: 'private-session',
				userId: 'owner-1',
				workspaceId: null,
				startedAt: new Date('2026-05-15T09:59:00.000Z')
			})
		);
		await repository.createConnectionSession(
			session({
				id: 'failed-workspace-session',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				hostId: 'workspace-host',
				status: 'failed',
				startedAt: new Date('2026-05-15T10:00:00.000Z'),
				endedAt: new Date('2026-05-15T10:00:03.000Z'),
				errorCode: 'auth_failed',
				errorMessage: 'Credential rejected',
				errorDetails: { attempts: 2 }
			})
		);
		await repository.createConnectionSession(
			session({
				id: 'newer-workspace-session',
				userId: 'member-1',
				workspaceId: 'workspace-1',
				hostId: null,
				protocol: 'rdp',
				status: 'ended',
				startedAt: new Date('2026-05-15T10:02:00.000Z'),
				endedAt: new Date('2026-05-15T10:02:10.000Z')
			})
		);

		await expect(repository.listConnectionHistory('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'newer-workspace-session' }),
			expect.objectContaining({ id: 'failed-workspace-session' })
		]);
		await expect(
			repository.listConnectionHistory('member-1', {
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				hostId: 'workspace-host',
				status: 'failed',
				startedAfter: new Date('2026-05-15T09:59:59.000Z'),
				startedBefore: new Date('2026-05-15T10:00:00.000Z')
			})
		).resolves.toEqual([
			expect.objectContaining({
				id: 'failed-workspace-session',
				workspaceName: 'Operations',
				hostName: 'Shared shell',
				hostname: 'shared.example.test',
				hostUsername: 'deploy',
				durationMs: 3000,
				errorReason: 'Credential rejected',
				errorDetails: { attempts: 2 }
			})
		]);
		await expect(
			repository.listConnectionHistory('member-1', { workspaceId: null })
		).resolves.toEqual([]);
		await expect(
			repository.listConnectionHistory('member-1', { protocol: 'ssh', status: 'ended' })
		).resolves.toEqual([]);
		await expect(repository.listConnectionHistory('outsider-1')).resolves.toEqual([]);
	});
});

function workspace(patch: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'workspace-1',
		name: 'Workspace',
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function membership(patch: Partial<WorkspaceMembershipRecord> = {}): WorkspaceMembershipRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'membership-1',
		workspaceId: 'workspace-1',
		userId: 'member-1',
		role: 'member',
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function host(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'host-1',
		userId: 'owner-1',
		workspaceId: null,
		name: 'Shell',
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

function credential(patch: Partial<CredentialRecord> = {}): CredentialRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'credential-1',
		userId: 'owner-1',
		workspaceId: null,
		name: 'Credential',
		kind: 'password',
		username: 'ops',
		encryptedSecret: 'encrypted-secret',
		encryption: {
			algorithm: 'aes-256-gcm',
			keyVersion: 1,
			iv: 'iv',
			authTag: 'auth-tag',
			salt: 'salt'
		},
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function session(patch: Partial<ConnectionSessionRecord> = {}): ConnectionSessionRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'connection-session-1',
		userId: 'user-1',
		workspaceId: null,
		hostId: null,
		protocol: 'ssh',
		status: 'starting',
		startedAt: now,
		endedAt: null,
		errorCode: null,
		errorMessage: null,
		errorDetails: null,
		updatedAt: now,
		...patch
	};
}
