import { describe, expect, it } from 'vitest';
import type { TermixDb } from '../../db';
import { DrizzleTermixServicesRepository, InMemoryTermixServicesRepository } from './index';
import {
	connectionSession,
	credentialRecord,
	hostRecord,
	sessionTicket,
	sshAttachTicket,
	sshLiveSession,
	sshTunnelProfile,
	sshTunnelSession,
	workspaceMembership,
	workspaceRecord
} from './repository-record-fixtures';

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

	it('preserves shared workspace record ownership when members update hosts and credentials', async () => {
		expect.assertions(4);

		const repository = new InMemoryTermixServicesRepository();
		const updatedAt = new Date('2026-05-14T10:02:00.000Z');
		await repository.createWorkspace(workspaceRecord({ id: 'workspace-1' }));
		await repository.createWorkspaceMembership(
			workspaceMembership({ id: 'member-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createHost(
			hostRecord({
				id: 'shared-host',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				name: 'Shared host'
			})
		);
		await repository.createCredential(
			credentialRecord({
				id: 'shared-credential',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				name: 'Shared credential'
			})
		);

		await expect(
			repository.updateHost('member-1', 'shared-host', { name: 'Renamed host', updatedAt })
		).resolves.toMatchObject({
			id: 'shared-host',
			userId: 'owner-1',
			name: 'Renamed host',
			updatedAt
		});
		await expect(repository.getHost('member-1', 'shared-host')).resolves.toMatchObject({
			id: 'shared-host',
			userId: 'owner-1',
			name: 'Renamed host'
		});
		await expect(
			repository.updateCredential('member-1', 'shared-credential', {
				name: 'Renamed credential',
				updatedAt
			})
		).resolves.toMatchObject({
			id: 'shared-credential',
			userId: 'owner-1',
			name: 'Renamed credential',
			updatedAt
		});
		await expect(repository.getCredential('member-1', 'shared-credential')).resolves.toMatchObject({
			id: 'shared-credential',
			userId: 'owner-1',
			name: 'Renamed credential'
		});
	});

	it('handles in-memory ticket and attach-ticket consumption idempotently', async () => {
		expect.assertions(8);

		const repository = new InMemoryTermixServicesRepository();
		const firstConsumedAt = new Date('2026-05-14T10:01:00.000Z');
		const secondConsumedAt = new Date('2026-05-14T10:02:00.000Z');
		await repository.createTicket(sessionTicket({ id: 'ticket-1', ticketHash: 'ticket-hash-1' }));
		await repository.createTicket(
			sessionTicket({
				id: 'ticket-2',
				ticketHash: 'already-used-ticket-hash',
				usedAt: firstConsumedAt
			})
		);
		await repository.createSshAttachTicket(
			sshAttachTicket({ id: 'attach-ticket-1', ticketHash: 'attach-ticket-hash-1' })
		);
		await repository.createSshAttachTicket(
			sshAttachTicket({
				id: 'attach-ticket-2',
				ticketHash: 'already-used-attach-ticket-hash',
				consumedAt: firstConsumedAt
			})
		);

		await expect(
			repository.consumeTicket('missing-ticket-hash', firstConsumedAt)
		).resolves.toBeNull();
		await expect(repository.consumeTicket('ticket-hash-1', firstConsumedAt)).resolves.toMatchObject(
			{
				id: 'ticket-1',
				usedAt: firstConsumedAt
			}
		);
		await expect(repository.consumeTicket('ticket-hash-1', secondConsumedAt)).resolves.toBeNull();
		await expect(
			repository.consumeTicket('already-used-ticket-hash', secondConsumedAt)
		).resolves.toBeNull();
		await expect(
			repository.consumeSshAttachTicket('missing-attach-ticket-hash', firstConsumedAt)
		).resolves.toBeNull();
		await expect(
			repository.consumeSshAttachTicket('attach-ticket-hash-1', firstConsumedAt)
		).resolves.toMatchObject({
			id: 'attach-ticket-1',
			consumedAt: firstConsumedAt
		});
		await expect(
			repository.consumeSshAttachTicket('attach-ticket-hash-1', secondConsumedAt)
		).resolves.toBeNull();
		await expect(
			repository.consumeSshAttachTicket('already-used-attach-ticket-hash', secondConsumedAt)
		).resolves.toBeNull();
	});

	it('filters in-memory tunnel profiles and sessions by workspace, owner, status, host, and profile', async () => {
		expect.assertions(8);

		const repository = new InMemoryTermixServicesRepository();
		const now = new Date('2026-05-14T10:00:00.000Z');
		await repository.createWorkspace(workspaceRecord({ id: 'workspace-1' }));
		await repository.createWorkspaceMembership(
			workspaceMembership({ id: 'member-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createSshTunnelProfile(
			sshTunnelProfile({
				id: 'private-profile',
				userId: 'owner-1',
				workspaceId: null,
				sshHostId: 'private-host'
			})
		);
		await repository.createSshTunnelProfile(
			sshTunnelProfile({
				id: 'shared-profile',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				sshHostId: 'shared-host'
			})
		);
		await repository.createSshTunnelSession(
			sshTunnelSession({
				id: 'private-session',
				profileId: 'private-profile',
				userId: 'owner-1',
				workspaceId: null,
				sshHostId: 'private-host',
				status: 'active',
				startedAt: now
			})
		);
		await repository.createSshTunnelSession(
			sshTunnelSession({
				id: 'shared-session',
				profileId: 'shared-profile',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				sshHostId: 'shared-host',
				status: 'idle',
				startedAt: new Date('2026-05-14T10:01:00.000Z')
			})
		);
		await repository.createSshTunnelSession(
			sshTunnelSession({
				id: 'detached-profile-session',
				profileId: null,
				userId: 'member-1',
				workspaceId: 'workspace-1',
				sshHostId: null,
				status: 'expired',
				startedAt: new Date('2026-05-14T10:02:00.000Z')
			})
		);

		await expect(repository.listSshTunnelProfiles('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'shared-profile' })
		]);
		await expect(
			repository.listSshTunnelProfiles('member-1', { userId: 'owner-1', sshHostId: 'shared-host' })
		).resolves.toEqual([expect.objectContaining({ id: 'shared-profile' })]);
		await expect(
			repository.listSshTunnelProfiles('member-1', { workspaceId: null })
		).resolves.toEqual([]);
		await expect(repository.listSshTunnelSessions('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'detached-profile-session' }),
			expect.objectContaining({ id: 'shared-session' })
		]);
		await expect(
			repository.listSshTunnelSessions('member-1', { status: 'idle', userId: 'owner-1' })
		).resolves.toEqual([expect.objectContaining({ id: 'shared-session' })]);
		await expect(
			repository.listSshTunnelSessions('member-1', { profileId: null, sshHostId: null })
		).resolves.toEqual([expect.objectContaining({ id: 'detached-profile-session' })]);
		await expect(
			repository.listSshTunnelSessions('member-1', { workspaceId: null })
		).resolves.toEqual([]);
		await expect(
			repository.getSshTunnelSession('outsider-1', 'shared-session')
		).resolves.toBeNull();
	});

	it('sets in-memory tunnel session profile references to null when deleting a tunnel profile', async () => {
		expect.assertions(3);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createSshTunnelProfile(sshTunnelProfile({ id: 'profile-1' }));
		await repository.createSshTunnelSession(
			sshTunnelSession({ id: 'session-1', profileId: 'profile-1' })
		);

		await expect(repository.deleteSshTunnelProfile('owner-1', 'profile-1')).resolves.toBe(true);
		await expect(repository.getSshTunnelProfile('owner-1', 'profile-1')).resolves.toBeNull();
		await expect(repository.getSshTunnelSession('owner-1', 'session-1')).resolves.toMatchObject({
			id: 'session-1',
			profileId: null,
			sshHostId: 'host-1'
		});
	});

	it('guards in-memory SSH live session reuse, stale marking, and detached expiry transitions', async () => {
		expect.assertions(10);

		const repository = new InMemoryTermixServicesRepository();
		const now = new Date('2026-05-14T10:00:00.000Z');
		const expiredAt = new Date('2026-05-14T09:59:00.000Z');
		const future = new Date('2026-05-14T10:05:00.000Z');
		await repository.createSshLiveSession(
			sshLiveSession({ id: 'attached-session', status: 'attached', createdAt: expiredAt })
		);
		await repository.createSshLiveSession(
			sshLiveSession({
				id: 'detached-session',
				status: 'detached',
				expiresAt: expiredAt,
				createdAt: expiredAt
			})
		);
		await repository.createSshLiveSession(
			sshLiveSession({
				id: 'future-starting-session',
				status: 'starting',
				expiresAt: future,
				createdAt: future
			})
		);
		await repository.createSshLiveSession(
			sshLiveSession({ id: 'failed-session', status: 'failed', createdAt: expiredAt })
		);

		await expect(repository.countOpenSshLiveSessions('owner-1')).resolves.toBe(3);
		await expect(repository.findReusableSshLiveSession('owner-1', 'host-1')).resolves.toMatchObject(
			{ id: 'attached-session' }
		);
		await expect(
			repository.updateSshLiveSession('owner-1', 'failed-session', {
				status: 'attached',
				updatedAt: now
			})
		).resolves.toBeNull();
		await expect(repository.markExpiredDetachedSshLiveSessions(now)).resolves.toEqual([
			expect.objectContaining({ id: 'detached-session', status: 'ended' })
		]);
		await expect(
			repository.getSshLiveSession('owner-1', 'detached-session')
		).resolves.toMatchObject({
			status: 'ended',
			endedAt: now,
			updatedAt: now
		});
		await expect(repository.markStaleSshLiveSessions(now)).resolves.toBe(1);
		await expect(
			repository.getSshLiveSession('owner-1', 'attached-session')
		).resolves.toMatchObject({
			status: 'stale',
			endedAt: now,
			updatedAt: now
		});
		await expect(
			repository.getSshLiveSession('owner-1', 'future-starting-session')
		).resolves.toMatchObject({ status: 'starting', endedAt: null });
		await expect(repository.countOpenSshLiveSessions('owner-1')).resolves.toBe(1);
		await expect(repository.findReusableSshLiveSession('owner-1', 'host-1')).resolves.toMatchObject(
			{ id: 'future-starting-session' }
		);
	});

	it('revokes workspace-scoped visibility after membership deletion without removing owner data', async () => {
		expect.assertions(11);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createWorkspace(workspaceRecord({ id: 'workspace-1', name: 'Operations' }));
		await repository.createWorkspaceMembership(
			workspaceMembership({
				id: 'owner-1',
				workspaceId: 'workspace-1',
				userId: 'owner-1',
				role: 'owner'
			})
		);
		await repository.createWorkspaceMembership(
			workspaceMembership({
				id: 'member-1',
				workspaceId: 'workspace-1',
				userId: 'member-1',
				role: 'member'
			})
		);
		await repository.createHost(
			hostRecord({ id: 'member-private-host', userId: 'member-1', workspaceId: null })
		);
		await repository.createHost(
			hostRecord({ id: 'shared-host', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createCredential(
			credentialRecord({
				id: 'shared-credential',
				userId: 'owner-1',
				workspaceId: 'workspace-1'
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'member-private-session',
				userId: 'member-1',
				workspaceId: null,
				hostId: 'member-private-host'
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'shared-session',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				hostId: 'shared-host'
			})
		);
		await repository.createSshTunnelProfile(
			sshTunnelProfile({
				id: 'shared-profile',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				sshHostId: 'shared-host'
			})
		);
		await repository.createSshTunnelSession(
			sshTunnelSession({
				id: 'shared-tunnel-session',
				profileId: 'shared-profile',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				sshHostId: 'shared-host'
			})
		);

		await expect(repository.getWorkspace('member-1', 'workspace-1')).resolves.toMatchObject({
			id: 'workspace-1'
		});
		await expect(repository.getHost('member-1', 'shared-host')).resolves.toMatchObject({
			id: 'shared-host'
		});
		await expect(repository.listConnectionHistory('member-1')).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'shared-session' }),
				expect.objectContaining({ id: 'member-private-session' })
			])
		);
		await expect(repository.deleteWorkspaceMembership('workspace-1', 'member-1')).resolves.toBe(
			true
		);

		await expect(repository.getWorkspace('member-1', 'workspace-1')).resolves.toBeNull();
		await expect(repository.getHost('member-1', 'shared-host')).resolves.toBeNull();
		await expect(repository.getCredential('member-1', 'shared-credential')).resolves.toBeNull();
		await expect(repository.listConnectionHistory('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'member-private-session' })
		]);
		await expect(repository.listSshTunnelProfiles('member-1')).resolves.toEqual([]);
		await expect(repository.listSshTunnelSessions('member-1')).resolves.toEqual([]);
		await expect(repository.getHost('owner-1', 'shared-host')).resolves.toMatchObject({
			id: 'shared-host',
			workspaceId: 'workspace-1'
		});
	});

	it('filters null-scoped connection history and falls back to error codes for failed rows', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		const startedAt = new Date('2026-05-14T10:00:00.000Z');
		const endedAt = new Date('2026-05-14T10:00:04.000Z');
		await repository.createWorkspace(workspaceRecord({ id: 'workspace-1' }));
		await repository.createWorkspaceMembership(
			workspaceMembership({ id: 'membership-1', workspaceId: 'workspace-1', userId: 'user-1' })
		);
		await repository.createHost(hostRecord({ id: 'host-1', userId: 'user-1' }));
		await repository.createConnectionSession(
			connectionSession({
				id: 'failed-with-code',
				userId: 'user-1',
				hostId: null,
				status: 'failed',
				startedAt,
				endedAt,
				errorCode: 'proxy_unavailable',
				errorMessage: null,
				errorDetails: { retryable: true }
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'active-with-host',
				userId: 'user-1',
				hostId: 'host-1',
				status: 'active',
				startedAt: new Date('2026-05-14T10:01:00.000Z')
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'workspace-row',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				hostId: null,
				status: 'ended',
				startedAt: new Date('2026-05-14T10:02:00.000Z')
			})
		);

		await expect(
			repository.listConnectionHistory('user-1', { workspaceId: null, hostId: null })
		).resolves.toEqual([
			expect.objectContaining({
				id: 'failed-with-code',
				workspaceName: null,
				hostName: null,
				durationMs: 4000,
				errorReason: 'proxy_unavailable',
				errorDetails: { retryable: true }
			})
		]);
		await expect(
			repository.listConnectionHistory('user-1', { status: 'failed', hostId: null })
		).resolves.toEqual([expect.objectContaining({ id: 'failed-with-code' })]);
		await expect(
			repository.listConnectionHistory('user-1', { status: 'active', workspaceId: null })
		).resolves.toEqual([expect.objectContaining({ id: 'active-with-host', durationMs: null })]);
		await expect(
			repository.listConnectionHistory('user-1', { userId: 'owner-1', workspaceId: 'workspace-1' })
		).resolves.toEqual([expect.objectContaining({ id: 'workspace-row' })]);
		await expect(
			repository.listConnectionHistory('user-1', { userId: 'owner-1', workspaceId: null })
		).resolves.toEqual([]);
	});

	it('keeps workspace layout updates scoped to the owning user and preserves updated panes', async () => {
		expect.assertions(8);

		const repository = new InMemoryTermixServicesRepository();
		const updatedAt = new Date('2026-05-14T10:03:00.000Z');
		await repository.createWorkspaceLayout({
			id: 'layout-1',
			userId: 'user-1',
			workspaceId: 'workspace-1',
			layoutKind: 'tabs',
			panes: [{ hostId: 'host-1', protocol: 'ssh' }],
			createdAt: new Date('2026-05-14T10:00:00.000Z'),
			updatedAt: new Date('2026-05-14T10:00:00.000Z')
		});
		await repository.createWorkspaceLayout({
			id: 'layout-2',
			userId: 'user-2',
			workspaceId: 'workspace-1',
			layoutKind: 'tabs',
			panes: [{ hostId: 'host-2', protocol: 'rdp' }],
			createdAt: new Date('2026-05-14T10:00:00.000Z'),
			updatedAt: new Date('2026-05-14T10:00:00.000Z')
		});

		await expect(
			repository.updateWorkspaceLayout('user-2', 'layout-1', { layoutKind: 'grid' })
		).resolves.toBeNull();
		await expect(
			repository.updateWorkspaceLayout('user-1', 'layout-1', {
				workspaceId: null,
				layoutKind: 'split',
				panes: [
					{ hostId: 'host-1', protocol: 'ssh', sessionId: 'session-1' },
					{ hostId: 'host-3', protocol: 'vnc', pinned: true }
				],
				updatedAt
			})
		).resolves.toMatchObject({
			id: 'layout-1',
			userId: 'user-1',
			workspaceId: null,
			layoutKind: 'split',
			panes: [
				{ hostId: 'host-1', protocol: 'ssh', sessionId: 'session-1' },
				{ hostId: 'host-3', protocol: 'vnc', pinned: true }
			],
			updatedAt
		});
		await expect(repository.listWorkspaceLayouts('user-1', { workspaceId: null })).resolves.toEqual(
			[expect.objectContaining({ id: 'layout-1', layoutKind: 'split' })]
		);
		await expect(
			repository.listWorkspaceLayouts('user-1', { workspaceId: 'workspace-1' })
		).resolves.toEqual([]);
		await expect(
			repository.listWorkspaceLayouts('user-2', { workspaceId: 'workspace-1' })
		).resolves.toEqual([expect.objectContaining({ id: 'layout-2' })]);
		await expect(repository.deleteWorkspaceLayout('user-2', 'layout-1')).resolves.toBe(false);
		await expect(repository.deleteWorkspaceLayout('user-1', 'layout-1')).resolves.toBe(true);
		await expect(repository.getWorkspaceLayout('user-1', 'layout-1')).resolves.toBeNull();
	});

	it('cleans up SSH live sessions and attach tickets when deleting a host', async () => {
		expect.assertions(9);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(hostRecord({ id: 'host-1', userId: 'owner-1' }));
		await repository.createHost(hostRecord({ id: 'host-2', userId: 'owner-1' }));
		await repository.createSshLiveSession(
			sshLiveSession({ id: 'host-1-session', hostId: 'host-1' })
		);
		await repository.createSshLiveSession(
			sshLiveSession({ id: 'host-2-session', hostId: 'host-2' })
		);
		await repository.createSshAttachTicket(
			sshAttachTicket({
				id: 'host-1-ticket',
				sshLiveSessionId: 'host-1-session',
				ticketHash: 'host-1-ticket-hash'
			})
		);
		await repository.createSshAttachTicket(
			sshAttachTicket({
				id: 'host-2-ticket',
				sshLiveSessionId: 'host-2-session',
				ticketHash: 'host-2-ticket-hash'
			})
		);

		await expect(repository.countOpenSshLiveSessions('owner-1')).resolves.toBe(2);
		await expect(repository.findReusableSshLiveSession('owner-1', 'host-1')).resolves.toMatchObject(
			{ id: 'host-1-session' }
		);
		await expect(repository.deleteHost('owner-1', 'missing-host')).resolves.toBe(false);
		await expect(repository.deleteHost('owner-1', 'host-1')).resolves.toBe(true);
		await expect(repository.getSshLiveSession('owner-1', 'host-1-session')).resolves.toBeNull();
		await expect(repository.getSshAttachTicketByHash('host-1-ticket-hash')).resolves.toBeNull();
		await expect(repository.countOpenSshLiveSessions('owner-1')).resolves.toBe(1);
		await expect(repository.findReusableSshLiveSession('owner-1', 'host-1')).resolves.toBeNull();
		await expect(repository.getSshAttachTicketByHash('host-2-ticket-hash')).resolves.toMatchObject({
			id: 'host-2-ticket',
			sshLiveSessionId: 'host-2-session'
		});
	});

	it('mirrors set-null and cascade delete semantics for in-memory host references', async () => {
		expect.assertions(13);

		const repository = new InMemoryTermixServicesRepository();
		const now = new Date('2026-05-14T10:00:00.000Z');
		await repository.createCredential(credentialRecord({ id: 'credential-1' }));
		await repository.createHost(
			hostRecord({
				id: 'host-1',
				credentialId: 'credential-1',
				workspaceId: null,
				createdAt: now,
				updatedAt: now
			})
		);
		await repository.createConnectionSession(
			connectionSession({
				id: 'connection-1',
				userId: 'owner-1',
				hostId: 'host-1',
				status: 'failed',
				errorCode: 'host_unreachable',
				errorMessage: 'Host unreachable'
			})
		);
		await repository.createTicket(
			sessionTicket({
				id: 'ticket-1',
				ticketHash: 'ticket-hash-1',
				hostId: 'host-1'
			})
		);
		await repository.createSshTunnelProfile(
			sshTunnelProfile({ id: 'profile-1', userId: 'owner-1', sshHostId: 'host-1' })
		);
		await repository.createSshTunnelSession(
			sshTunnelSession({
				id: 'tunnel-session-1',
				profileId: 'profile-1',
				userId: 'owner-1',
				sshHostId: 'host-1'
			})
		);
		await repository.createSshLiveSession(
			sshLiveSession({ id: 'live-session-1', userId: 'owner-1', hostId: 'host-1' })
		);
		await repository.createSshAttachTicket(
			sshAttachTicket({
				id: 'attach-ticket-1',
				userId: 'owner-1',
				sshLiveSessionId: 'live-session-1',
				ticketHash: 'attach-ticket-hash-1'
			})
		);

		await expect(repository.deleteCredential('owner-1', 'credential-1')).resolves.toBe(true);
		await expect(repository.getHost('owner-1', 'host-1')).resolves.toMatchObject({
			credentialId: null
		});
		await expect(repository.getTicketByHash('ticket-hash-1')).resolves.toMatchObject({
			hostId: 'host-1'
		});
		await expect(repository.getSshLiveSession('owner-1', 'live-session-1')).resolves.toMatchObject({
			hostId: 'host-1'
		});
		await expect(
			repository.getSshAttachTicketByHash('attach-ticket-hash-1')
		).resolves.toMatchObject({
			sshLiveSessionId: 'live-session-1'
		});

		await expect(repository.deleteHost('owner-1', 'host-1')).resolves.toBe(true);
		await expect(repository.getHost('owner-1', 'host-1')).resolves.toBeNull();
		await expect(repository.getTicketByHash('ticket-hash-1')).resolves.toBeNull();
		await expect(repository.getSshLiveSession('owner-1', 'live-session-1')).resolves.toBeNull();
		await expect(repository.getSshAttachTicketByHash('attach-ticket-hash-1')).resolves.toBeNull();
		await expect(repository.listConnectionHistory('owner-1')).resolves.toEqual([
			expect.objectContaining({
				id: 'connection-1',
				hostId: null,
				hostName: null,
				hostname: null,
				errorReason: 'Host unreachable'
			})
		]);
		await expect(repository.getSshTunnelProfile('owner-1', 'profile-1')).resolves.toBeNull();
		await expect(repository.getSshTunnelSession('owner-1', 'tunnel-session-1')).resolves.toEqual(
			expect.objectContaining({ profileId: null, sshHostId: null })
		);
	});
});
