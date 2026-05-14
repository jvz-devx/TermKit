import { describe, expect, it } from 'vitest';
import type { TermixDb } from '../db';
import { DrizzleTermixServicesRepository, InMemoryTermixServicesRepository } from './repository';
import type {
	ConnectionSessionRecord,
	HostRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from './types';

function queryResult<T>(rows: T[]) {
	return {
		limit: (count: number) => Promise.resolve(rows.slice(0, count)),
		then: Promise.resolve(rows).then.bind(Promise.resolve(rows))
	};
}

function fakeSelectDb<T>(rows: T[]): TermixDb {
	return {
		select: () => ({
			from: () => ({
				where: () => queryResult(rows)
			})
		})
	} as unknown as TermixDb;
}

function fakeInsertDb<T>(rows: T[], capture: (values: unknown) => void): TermixDb {
	return {
		insert: () => ({
			values: (values: unknown) => {
				capture(values);
				return {
					returning: () => Promise.resolve(rows)
				};
			}
		})
	} as unknown as TermixDb;
}

describe('DrizzleTermixServicesRepository', () => {
	it('maps credential rows to service records', async () => {
		expect.assertions(1);

		const now = new Date('2026-05-13T12:00:00.000Z');
		const encryptionMetadata = {
			algorithm: 'aes-256-gcm' as const,
			keyVersion: 3,
			iv: 'iv',
			authTag: 'auth-tag',
			salt: 'salt'
		};
		const repository = new DrizzleTermixServicesRepository(
			fakeSelectDb([
				{
					id: 'credential-1',
					userId: 'user-1',
					name: 'Prod password',
					kind: 'password',
					username: 'root',
					encryptedSecret: 'ciphertext',
					encryptionMetadata,
					metadata: { source: 'test' },
					createdAt: now,
					updatedAt: now
				}
			])
		);

		await expect(repository.listCredentials('user-1')).resolves.toEqual([
			{
				id: 'credential-1',
				userId: 'user-1',
				name: 'Prod password',
				kind: 'password',
				username: 'root',
				encryptedSecret: 'ciphertext',
				encryption: encryptionMetadata,
				metadata: { source: 'test' },
				createdAt: now,
				updatedAt: now
			}
		]);
	});

	it('maps session ticket targets between service strings and db json', async () => {
		expect.assertions(3);

		const now = new Date('2026-05-13T12:00:00.000Z');
		let capturedValues: unknown;
		const repository = new DrizzleTermixServicesRepository(
			fakeInsertDb(
				[
					{
						id: 'ticket-1',
						ticketHash: 'ticket-hash',
						userId: 'user-1',
						hostId: 'host-1',
						protocol: 'ssh',
						target: { value: 'ssh:shell.example.test:22' },
						expiresAt: new Date('2026-05-13T12:01:00.000Z'),
						consumedAt: null,
						createdAt: now
					}
				],
				(values) => {
					capturedValues = values;
				}
			)
		);

		const ticket = await repository.createTicket({
			id: 'ticket-1',
			ticketHash: 'ticket-hash',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			target: 'ssh:shell.example.test:22',
			expiresAt: new Date('2026-05-13T12:01:00.000Z'),
			usedAt: null,
			createdAt: now
		});

		expect(capturedValues).toMatchObject({ target: { value: 'ssh:shell.example.test:22' } });
		expect(ticket.target).toBe('ssh:shell.example.test:22');
		expect(ticket.usedAt).toBeNull();
	});

	it('stores V4 tunnel profiles, tunnel sessions, and workspace layouts in memory', async () => {
		expect.assertions(7);

		const repository = new InMemoryTermixServicesRepository();
		const now = new Date('2026-05-14T10:00:00.000Z');

		await repository.createWorkspace({
			id: 'workspace-1',
			name: 'Operations',
			metadata: {},
			createdAt: now,
			updatedAt: now
		});
		await repository.createWorkspaceMembership({
			id: 'membership-1',
			workspaceId: 'workspace-1',
			userId: 'user-1',
			role: 'owner',
			createdAt: now,
			updatedAt: now
		});
		await repository.createSshTunnelProfile({
			id: 'profile-1',
			userId: 'user-1',
			workspaceId: 'workspace-1',
			sshHostId: 'host-1',
			name: 'Private Postgres',
			targetHost: 'postgres.internal',
			targetPort: 5432,
			description: 'Database tunnel',
			createdAt: now,
			updatedAt: now
		});
		await repository.createSshTunnelSession({
			id: 'tunnel-session-1',
			profileId: 'profile-1',
			userId: 'user-1',
			workspaceId: 'workspace-1',
			sshHostId: 'host-1',
			targetHost: 'postgres.internal',
			targetPort: 5432,
			publicPath: '/tunnels/tunnel-session-1',
			status: 'starting',
			startedAt: now,
			endedAt: null,
			lastSeenAt: now,
			errorCode: null,
			errorMessage: null
		});
		await repository.createWorkspaceLayout({
			id: 'layout-1',
			userId: 'user-1',
			workspaceId: 'workspace-1',
			layoutKind: 'tiled',
			panes: [{ hostId: 'host-1', protocol: 'ssh', sessionId: 'session-1' }],
			createdAt: now,
			updatedAt: now
		});

		expect(
			await repository.listSshTunnelProfiles('user-1', { workspaceId: 'workspace-1' })
		).toHaveLength(1);
		await expect(repository.getSshTunnelProfile('user-2', 'profile-1')).resolves.toBeNull();
		await expect(
			repository.updateSshTunnelSession('user-1', 'tunnel-session-1', {
				status: 'active',
				lastSeenAt: new Date('2026-05-14T10:01:00.000Z')
			})
		).resolves.toMatchObject({ status: 'active' });
		await expect(
			repository.listSshTunnelSessions('user-1', { status: 'active' })
		).resolves.toHaveLength(1);
		await expect(
			repository.listWorkspaceLayouts('user-1', { layoutKind: 'tiled' })
		).resolves.toHaveLength(1);
		await expect(repository.deleteWorkspaceLayout('user-1', 'layout-1')).resolves.toBe(true);
		await expect(repository.getWorkspaceLayout('user-1', 'layout-1')).resolves.toBeNull();
	});

	it('keeps structured connection history errors for V4 protocols', async () => {
		expect.assertions(1);

		const repository = new InMemoryTermixServicesRepository();
		const startedAt = new Date('2026-05-14T10:00:00.000Z');
		const endedAt = new Date('2026-05-14T10:00:05.000Z');

		await repository.createConnectionSession({
			id: 'connection-1',
			userId: 'user-1',
			workspaceId: null,
			hostId: null,
			protocol: 'ssh_tunnel',
			status: 'failed',
			startedAt,
			endedAt,
			errorCode: 'target_refused',
			errorMessage: 'Target refused connection',
			errorDetails: { targetHost: 'postgres.internal', targetPort: 5432 },
			updatedAt: endedAt
		});

		await expect(
			repository.listConnectionHistory('user-1', { protocol: 'ssh_tunnel' })
		).resolves.toEqual([
			expect.objectContaining({
				protocol: 'ssh_tunnel',
				errorReason: 'Target refused connection',
				errorCode: 'target_refused',
				errorMessage: 'Target refused connection',
				errorDetails: { targetHost: 'postgres.internal', targetPort: 5432 }
			})
		]);
	});

	it('filters in-memory connection history across shared workspaces without leaking private rows', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		const now = new Date('2026-05-14T10:00:00.000Z');
		await repository.createWorkspace(workspaceRecord({ id: 'workspace-1', name: 'Shared Ops' }));
		await repository.createWorkspaceMembership(
			workspaceMembership({ id: 'member-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createHost(
			hostRecord({
				id: 'shared-host',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				name: 'Shared SSH',
				hostname: 'shared.example.test',
				username: 'deploy'
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'private-owner-session',
				userId: 'owner-1',
				workspaceId: null,
				hostId: null,
				startedAt: new Date('2026-05-14T09:59:00.000Z')
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'shared-failed-session',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				hostId: 'shared-host',
				status: 'failed',
				startedAt: now,
				endedAt: new Date('2026-05-14T10:00:03.000Z'),
				errorCode: 'auth_failed',
				errorMessage: 'Credential rejected',
				errorDetails: { attempts: 2 }
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'shared-rdp-session',
				userId: 'member-1',
				workspaceId: 'workspace-1',
				hostId: null,
				protocol: 'rdp',
				startedAt: new Date('2026-05-14T10:01:00.000Z')
			})
		);

		await expect(repository.listConnectionHistory('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'shared-rdp-session' }),
			expect.objectContaining({ id: 'shared-failed-session' })
		]);
		await expect(
			repository.listConnectionHistory('member-1', { userId: 'owner-1', status: 'failed' })
		).resolves.toEqual([
			expect.objectContaining({
				id: 'shared-failed-session',
				workspaceName: 'Shared Ops',
				hostName: 'Shared SSH',
				hostname: 'shared.example.test',
				hostUsername: 'deploy',
				durationMs: 3000,
				errorReason: 'Credential rejected',
				errorDetails: { attempts: 2 }
			})
		]);
		await expect(
			repository.listConnectionHistory('member-1', {
				protocol: 'ssh',
				startedAfter: new Date('2026-05-14T09:59:30.000Z'),
				startedBefore: new Date('2026-05-14T10:00:30.000Z')
			})
		).resolves.toEqual([expect.objectContaining({ id: 'shared-failed-session' })]);
		await expect(repository.listConnectionHistory('outsider-1')).resolves.toEqual([]);
		await expect(repository.listConnectionHistory('member-1')).resolves.not.toContainEqual(
			expect.objectContaining({ id: 'private-owner-session' })
		);
	});
});

function workspaceRecord(patch: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'workspace-1',
		name: 'Workspace',
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function workspaceMembership(
	patch: Partial<WorkspaceMembershipRecord> = {}
): WorkspaceMembershipRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
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

function hostRecord(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
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

function connectionSession(patch: Partial<ConnectionSessionRecord> = {}): ConnectionSessionRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'connection-1',
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
