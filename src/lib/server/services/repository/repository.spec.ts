import { describe, expect, it, vi } from 'vitest';
import type { TermixDb } from '../../db';
import * as dbSchema from '../../db/schema';
import { DrizzleTermixServicesRepository, InMemoryTermixServicesRepository } from './index';
import type {
	ConnectionSessionPatch,
	ConnectionSessionRecord,
	CredentialRecord,
	HostRecord,
	SessionTicketRecord,
	SshAttachTicketRecord,
	SshLiveSessionRecord,
	SshTunnelProfileRecord,
	SshTunnelSessionRecord,
	WorkspaceLayoutRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from '../types';
import { InMemoryV5ResourcesRepository, type TerminalRecordingRecord } from '../v5-resources';
import {
	InMemoryV6ResourcesRepository,
	type ApprovalRequestRecord,
	type AutomationTemplateRecord,
	type BackgroundJobRecord,
	type HostFactsRecord,
	type HostHealthRecord,
	type JobEventRecord,
	type JobReportRecord,
	type JobTargetRecord,
	type OperationReasonRecord,
	type WorkspacePolicyRecord
} from '../v6-resources';

describe('DrizzleTermixServicesRepository mapping and query chains', () => {
	it('maps workspace rows and uses focused insert/update/delete payloads', async () => {
		expect.assertions(8);

		const now = new Date('2026-05-15T10:00:00.000Z');
		const updatedAt = new Date('2026-05-15T10:10:00.000Z');
		const workspaceRow = workspace({ id: 'workspace-1', metadata: null as never });
		const membershipRow = membership({ id: 'membership-1', workspaceId: 'workspace-1' });
		const updatedWorkspaceRow = workspace({
			id: 'workspace-1',
			name: 'Renamed workspace',
			metadata: { pinned: true },
			updatedAt
		});
		const updatedMembershipRow = membership({
			id: 'membership-1',
			workspaceId: 'workspace-1',
			role: 'owner',
			updatedAt
		});
		const db = createDrizzleDbMock({
			selectRows: new Map<unknown, unknown[]>([
				[dbSchema.workspaceMemberships, [membershipRow]],
				[dbSchema.workspaces, [workspaceRow]]
			]),
			insertRows: new Map<unknown, unknown[][]>([[dbSchema.workspaces, [[workspaceRow]]]]),
			updateRows: new Map<unknown, unknown[][]>([
				[dbSchema.workspaces, [[updatedWorkspaceRow]]],
				[dbSchema.workspaceMemberships, [[updatedMembershipRow]]]
			]),
			deleteRows: new Map<unknown, unknown[]>([
				[dbSchema.workspaceMemberships, [{ id: 'membership-1' }]]
			])
		});
		const repository = new DrizzleTermixServicesRepository(db.database);

		await expect(repository.listWorkspaces('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'workspace-1', metadata: {} })
		]);
		await expect(
			repository.createWorkspace(workspace({ id: 'workspace-1', metadata: { source: 'created' } }))
		).resolves.toMatchObject({ id: 'workspace-1' });
		await expect(
			repository.updateWorkspace('workspace-1', {
				name: 'Renamed workspace',
				metadata: { pinned: true },
				updatedAt
			})
		).resolves.toMatchObject({ name: 'Renamed workspace', metadata: { pinned: true } });
		await expect(
			repository.updateWorkspaceMembership('workspace-1', 'member-1', { role: 'owner', updatedAt })
		).resolves.toMatchObject({ role: 'owner', updatedAt });
		await expect(repository.deleteWorkspaceMembership('workspace-1', 'member-1')).resolves.toBe(
			true
		);

		expect(operationCall(db.calls, 'insert', dbSchema.workspaces).values).toMatchObject({
			id: 'workspace-1',
			name: 'Workspace',
			metadata: { source: 'created' },
			createdAt: now,
			updatedAt: now
		});
		expect(operationCall(db.calls, 'update', dbSchema.workspaces).values).toEqual({
			name: 'Renamed workspace',
			metadata: { pinned: true },
			updatedAt
		});
		expect(operationCall(db.calls, 'update', dbSchema.workspaceMemberships).values).toEqual({
			role: 'owner',
			updatedAt
		});
	});

	it('maps host and credential rows while preserving Drizzle patch semantics', async () => {
		expect.assertions(8);

		const updatedAt = new Date('2026-05-15T10:11:00.000Z');
		const encryptionMetadata = {
			algorithm: 'aes-256-gcm' as const,
			keyVersion: 7,
			iv: 'iv',
			authTag: 'auth-tag',
			salt: 'salt'
		};
		const hostRow = host({
			id: 'workspace-host',
			userId: 'owner-1',
			workspaceId: 'workspace-1',
			username: 'deploy',
			tags: ['prod'],
			metadata: null as never
		});
		const credentialRow = {
			...credential({
				id: 'workspace-credential',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				kind: 'ssh_key',
				username: null,
				metadata: { imported: true }
			}),
			encryptionMetadata
		};
		delete (credentialRow as { encryption?: unknown }).encryption;
		const db = createDrizzleDbMock({
			selectRows: new Map<unknown, unknown[]>([
				[
					dbSchema.workspaceMemberships,
					[membership({ workspaceId: 'workspace-1', userId: 'member-1' })]
				],
				[dbSchema.hosts, [hostRow]],
				[dbSchema.credentials, [credentialRow]]
			]),
			insertRows: new Map<unknown, unknown[][]>([
				[dbSchema.hosts, [[hostRow]]],
				[dbSchema.credentials, [[credentialRow]]]
			]),
			updateRows: new Map<unknown, unknown[][]>([
				[
					dbSchema.hosts,
					[
						[
							host({
								...hostRow,
								name: 'Renamed host',
								port: 2222,
								metadata: { audited: true },
								updatedAt
							})
						]
					]
				],
				[
					dbSchema.credentials,
					[
						[
							{
								...credentialRow,
								name: 'Renamed credential',
								encryptedSecret: 'rotated-secret',
								updatedAt
							}
						]
					]
				]
			])
		});
		const repository = new DrizzleTermixServicesRepository(db.database);

		await expect(repository.listHosts('member-1')).resolves.toEqual([
			expect.objectContaining({
				id: 'workspace-host',
				workspaceId: 'workspace-1',
				username: 'deploy',
				metadata: {}
			})
		]);
		await expect(repository.listCredentials('member-1')).resolves.toEqual([
			expect.objectContaining({
				id: 'workspace-credential',
				kind: 'ssh_key',
				username: null,
				encryption: encryptionMetadata,
				metadata: { imported: true }
			})
		]);
		await expect(repository.createHost(hostRow)).resolves.toMatchObject({ id: 'workspace-host' });
		await expect(
			repository.createCredential(
				credential({ id: 'workspace-credential', encryption: encryptionMetadata })
			)
		).resolves.toMatchObject({ id: 'workspace-credential', encryption: encryptionMetadata });
		await expect(
			repository.updateHost('member-1', 'workspace-host', {
				name: 'Renamed host',
				port: 2222,
				metadata: { audited: true },
				updatedAt
			})
		).resolves.toMatchObject({ name: 'Renamed host', port: 2222 });
		await expect(
			repository.updateCredential('member-1', 'workspace-credential', {
				name: 'Renamed credential',
				encryptedSecret: 'rotated-secret',
				updatedAt
			})
		).resolves.toMatchObject({ name: 'Renamed credential', encryptedSecret: 'rotated-secret' });
		expect(operationCall(db.calls, 'insert', dbSchema.credentials).values).toMatchObject({
			encryptionMetadata
		});
		expect(operationCall(db.calls, 'update', dbSchema.hosts).values).toEqual({
			workspaceId: undefined,
			name: 'Renamed host',
			protocol: undefined,
			hostname: undefined,
			port: 2222,
			username: undefined,
			credentialId: undefined,
			folder: undefined,
			tags: undefined,
			notes: undefined,
			metadata: { audited: true },
			updatedAt
		});
	});

	it('enriches connection history and maps session ticket edge cases', async () => {
		expect.assertions(6);

		const now = new Date('2026-05-15T10:00:00.000Z');
		const endedAt = new Date('2026-05-15T10:00:30.000Z');
		const updatedAt = new Date('2026-05-15T10:12:00.000Z');
		const db = createDrizzleDbMock({
			selectRows: new Map<unknown, unknown[]>([
				[
					dbSchema.workspaceMemberships,
					[membership({ workspaceId: 'workspace-1', userId: 'member-1' })]
				],
				[
					dbSchema.connectionSessions,
					[
						session({
							id: 'failed-session',
							userId: 'owner-1',
							workspaceId: 'workspace-1',
							hostId: 'host-1',
							status: 'failed',
							startedAt: now,
							endedAt,
							errorCode: 'proxy_closed',
							errorMessage: null,
							errorDetails: { exitCode: 255 }
						}),
						session({
							id: 'filtered-session',
							userId: 'owner-1',
							workspaceId: 'workspace-1',
							hostId: 'host-1',
							status: 'ended',
							startedAt: new Date('2026-05-15T09:59:00.000Z')
						})
					]
				],
				[dbSchema.hosts, [host({ id: 'host-1', name: 'Shared host', username: 'deploy' })]],
				[dbSchema.workspaces, [workspace({ id: 'workspace-1', name: 'Operations' })]],
				[
					dbSchema.users,
					[
						{
							id: 'owner-1',
							username: 'owner',
							passwordHash: 'hash',
							isAdmin: false,
							disabledAt: null,
							createdAt: now,
							updatedAt: now
						}
					]
				],
				[
					dbSchema.sessionTickets,
					[
						{
							id: 'ticket-1',
							ticketHash: 'ticket-hash',
							userId: 'owner-1',
							hostId: 'host-1',
							protocol: 'ssh',
							target: { nested: 'shape' },
							expiresAt: new Date('2026-05-15T10:05:00.000Z'),
							consumedAt: null,
							createdAt: now
						}
					]
				]
			]),
			updateRows: new Map<unknown, unknown[][]>([
				[
					dbSchema.connectionSessions,
					[
						[
							session({
								id: 'failed-session',
								status: 'ended',
								endedAt,
								errorCode: null,
								errorMessage: null,
								errorDetails: null,
								updatedAt
							})
						]
					]
				],
				[
					dbSchema.sessionTickets,
					[
						[
							{
								id: 'ticket-1',
								ticketHash: 'ticket-hash',
								userId: 'owner-1',
								hostId: 'host-1',
								protocol: 'ssh',
								target: {},
								expiresAt: new Date('2026-05-15T10:05:00.000Z'),
								consumedAt: updatedAt,
								createdAt: now
							}
						]
					]
				]
			])
		});
		const repository = new DrizzleTermixServicesRepository(db.database);

		await expect(
			repository.listConnectionHistory('member-1', {
				workspaceId: 'workspace-1',
				status: 'failed',
				startedAfter: now,
				startedBefore: now
			})
		).resolves.toEqual([
			expect.objectContaining({
				id: 'failed-session',
				username: 'owner',
				workspaceName: 'Operations',
				hostName: 'Shared host',
				hostname: 'shell.example.test',
				hostUsername: 'deploy',
				durationMs: 30000,
				errorReason: 'proxy_closed',
				errorDetails: { exitCode: 255 }
			})
		]);
		await expect(
			repository.updateConnectionSession('failed-session', {
				status: 'ended',
				endedAt,
				errorCode: null,
				errorMessage: null,
				errorDetails: null,
				updatedAt
			})
		).resolves.toMatchObject({ id: 'failed-session', status: 'ended', updatedAt });
		await expect(repository.getTicketByHash('ticket-hash')).resolves.toMatchObject({
			id: 'ticket-1',
			target: '{"nested":"shape"}'
		});
		await expect(repository.consumeTicket('ticket-hash', updatedAt)).resolves.toMatchObject({
			id: 'ticket-1',
			target: '{}',
			usedAt: updatedAt
		});
		expect(operationCall(db.calls, 'update', dbSchema.connectionSessions).values).toEqual({
			status: 'ended',
			endedAt,
			errorCode: null,
			errorMessage: null,
			errorDetails: null,
			updatedAt
		});
		expect(operationCall(db.calls, 'update', dbSchema.sessionTickets).values).toEqual({
			consumedAt: updatedAt
		});
	});

	it('maps SSH tunnel profiles, sessions, and workspace layouts through Drizzle helpers', async () => {
		expect.assertions(8);

		const updatedAt = new Date('2026-05-15T10:13:00.000Z');
		const layoutRow = workspaceLayout({
			id: 'layout-1',
			userId: 'member-1',
			workspaceId: 'workspace-1',
			layoutKind: 'split',
			panes: [{ hostId: 'host-1' }]
		});
		const db = createDrizzleDbMock({
			selectRows: new Map<unknown, unknown[]>([
				[
					dbSchema.workspaceMemberships,
					[membership({ workspaceId: 'workspace-1', userId: 'member-1' })]
				],
				[
					dbSchema.sshTunnelProfiles,
					[
						sshTunnelProfile({
							id: 'profile-1',
							userId: 'owner-1',
							workspaceId: 'workspace-1',
							sshHostId: 'host-1'
						})
					]
				],
				[
					dbSchema.sshTunnelSessions,
					[
						sshTunnelSession({
							id: 'session-old',
							userId: 'owner-1',
							workspaceId: 'workspace-1',
							status: 'active',
							startedAt: new Date('2026-05-15T09:59:00.000Z')
						}),
						sshTunnelSession({
							id: 'session-new',
							userId: 'owner-1',
							workspaceId: 'workspace-1',
							status: 'active',
							startedAt: new Date('2026-05-15T10:01:00.000Z')
						})
					]
				],
				[dbSchema.workspaceLayouts, [layoutRow]]
			]),
			insertRows: new Map<unknown, unknown[][]>([[dbSchema.workspaceLayouts, [[layoutRow]]]]),
			updateRows: new Map<unknown, unknown[][]>([
				[
					dbSchema.sshTunnelProfiles,
					[
						[
							sshTunnelProfile({
								id: 'profile-1',
								name: 'Updated tunnel',
								description: 'Operator tunnel',
								updatedAt
							})
						]
					]
				],
				[
					dbSchema.sshTunnelSessions,
					[
						[
							sshTunnelSession({
								id: 'session-new',
								status: 'ended',
								endedAt: updatedAt,
								lastSeenAt: updatedAt
							})
						]
					]
				],
				[
					dbSchema.workspaceLayouts,
					[
						[
							workspaceLayout({
								id: 'layout-1',
								userId: 'member-1',
								workspaceId: null,
								layoutKind: 'tabs',
								panes: [{ hostId: 'host-2' }],
								updatedAt
							})
						]
					]
				]
			]),
			deleteRows: new Map<unknown, unknown[]>([[dbSchema.workspaceLayouts, [{ id: 'layout-1' }]]])
		});
		const repository = new DrizzleTermixServicesRepository(db.database);

		await expect(
			repository.listSshTunnelProfiles('member-1', {
				workspaceId: 'workspace-1',
				sshHostId: 'host-1'
			})
		).resolves.toEqual([expect.objectContaining({ id: 'profile-1', workspaceId: 'workspace-1' })]);
		await expect(
			repository.listSshTunnelSessions('member-1', { status: 'active' })
		).resolves.toEqual([
			expect.objectContaining({ id: 'session-new' }),
			expect.objectContaining({ id: 'session-old' })
		]);
		await expect(
			repository.updateSshTunnelProfile('member-1', 'profile-1', {
				name: 'Updated tunnel',
				description: 'Operator tunnel',
				updatedAt
			})
		).resolves.toMatchObject({ name: 'Updated tunnel', description: 'Operator tunnel' });
		await expect(
			repository.updateSshTunnelSession('member-1', 'session-new', {
				status: 'ended',
				endedAt: updatedAt,
				lastSeenAt: updatedAt
			})
		).resolves.toMatchObject({ id: 'session-new', status: 'ended', endedAt: updatedAt });
		await expect(
			repository.listWorkspaceLayouts('member-1', {
				workspaceId: 'workspace-1',
				layoutKind: 'split'
			})
		).resolves.toEqual([
			expect.objectContaining({ id: 'layout-1', panes: [{ hostId: 'host-1' }] })
		]);
		await expect(repository.createWorkspaceLayout(layoutRow)).resolves.toMatchObject({
			id: 'layout-1',
			layoutKind: 'split'
		});
		await expect(
			repository.updateWorkspaceLayout('member-1', 'layout-1', {
				workspaceId: null,
				layoutKind: 'tabs',
				panes: [{ hostId: 'host-2' }],
				updatedAt
			})
		).resolves.toMatchObject({ layoutKind: 'tabs', workspaceId: null });
		await expect(repository.deleteWorkspaceLayout('member-1', 'layout-1')).resolves.toBe(true);
	});

	it('applies SSH live status guards and maps attach ticket rows', async () => {
		expect.assertions(8);

		const now = new Date('2026-05-15T10:14:00.000Z');
		const expiredAt = new Date('2026-05-15T10:15:00.000Z');
		const db = createDrizzleDbMock({
			selectRows: new Map<unknown, unknown[]>([
				[
					dbSchema.sshLiveSessions,
					[
						sshLiveSession({ id: 'starting-live', status: 'starting', createdAt: now }),
						sshLiveSession({ id: 'ended-live', status: 'ended', createdAt: now })
					]
				],
				[
					dbSchema.sshAttachTickets,
					[
						sshAttachTicket({
							id: 'attach-ticket-1',
							ticketHash: 'attach-ticket-hash-1',
							consumedAt: null
						})
					]
				]
			]),
			insertRows: new Map<unknown, unknown[][]>([
				[dbSchema.sshLiveSessions, [[sshLiveSession({ id: 'created-live', status: 'starting' })]]],
				[dbSchema.sshAttachTickets, [[sshAttachTicket({ id: 'created-ticket' })]]]
			]),
			updateRows: new Map<unknown, unknown[][]>([
				[
					dbSchema.sshLiveSessions,
					[
						[
							sshLiveSession({ id: 'starting-live', status: 'ended', endedAt: now, updatedAt: now })
						],
						[{ id: 'starting-live' }, { id: 'detached-live' }],
						[
							sshLiveSession({
								id: 'expired-live',
								status: 'ended',
								expiresAt: new Date('2026-05-15T10:13:00.000Z'),
								endedAt: expiredAt,
								updatedAt: expiredAt
							})
						]
					]
				],
				[
					dbSchema.sshAttachTickets,
					[
						[
							sshAttachTicket({
								id: 'attach-ticket-1',
								ticketHash: 'attach-ticket-hash-1',
								consumedAt: now
							})
						]
					]
				]
			])
		});
		const repository = new DrizzleTermixServicesRepository(db.database);

		await expect(repository.countOpenSshLiveSessions('owner-1')).resolves.toBe(1);
		await expect(
			repository.createSshLiveSession(sshLiveSession({ id: 'created-live', status: 'starting' }))
		).resolves.toMatchObject({ id: 'created-live', status: 'starting' });
		await expect(
			repository.updateSshLiveSession('owner-1', 'starting-live', {
				status: 'ended',
				endedAt: now,
				updatedAt: now
			})
		).resolves.toMatchObject({ id: 'starting-live', status: 'ended', endedAt: now });
		await expect(repository.markStaleSshLiveSessions(now)).resolves.toBe(2);
		await expect(repository.markExpiredDetachedSshLiveSessions(expiredAt)).resolves.toEqual([
			expect.objectContaining({ id: 'expired-live', status: 'ended', endedAt: expiredAt })
		]);
		await expect(
			repository.createSshAttachTicket(sshAttachTicket({ id: 'created-ticket' }))
		).resolves.toMatchObject({
			id: 'created-ticket'
		});
		await expect(
			repository.consumeSshAttachTicket('attach-ticket-hash-1', now)
		).resolves.toMatchObject({
			id: 'attach-ticket-1',
			consumedAt: now
		});
		expect(operationCall(db.calls, 'update', dbSchema.sshLiveSessions).values).toEqual({
			title: undefined,
			status: 'ended',
			lastAttachedAt: undefined,
			detachedAt: undefined,
			expiresAt: undefined,
			endedAt: now,
			terminalCols: undefined,
			terminalRows: undefined,
			updatedAt: now
		});
	});

	it('throws a clear error when SSH live schema exports are missing', async () => {
		expect.assertions(1);

		vi.resetModules();
		vi.doMock('../../db/schema', async (importOriginal) => {
			const actual = await importOriginal<typeof import('../../db/schema')>();
			return { ...actual, sshLiveSessions: undefined, sshAttachTickets: undefined };
		});

		try {
			const { DrizzleTermixServicesRepository: RepositoryWithMissingLiveSchema } =
				await import('./index');
			const repository = new RepositoryWithMissingLiveSchema(createDrizzleDbMock().database);

			await expect(repository.listSshLiveSessions('owner-1')).rejects.toThrow(
				'SSH live session schema is not available'
			);
		} finally {
			vi.doUnmock('../db/schema');
			vi.resetModules();
		}
	});
});

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

	it('persists connection session updates and keeps miss paths null', async () => {
		expect.assertions(6);

		const repository = new InMemoryTermixServicesRepository();
		const endedAt = new Date('2026-05-15T10:03:00.000Z');
		const updatedAt = new Date('2026-05-15T10:03:01.000Z');
		await repository.createConnectionSession(
			session({
				id: 'session-1',
				userId: 'user-1',
				hostId: 'host-1',
				status: 'active'
			})
		);

		await expect(repository.getConnectionSession('session-1')).resolves.toMatchObject({
			id: 'session-1',
			status: 'active'
		});
		await expect(
			repository.updateConnectionSession(
				'missing-session',
				connectionSessionPatch({ status: 'ended' })
			)
		).resolves.toBeNull();
		await expect(
			repository.updateConnectionSession(
				'session-1',
				connectionSessionPatch({
					status: 'failed',
					endedAt,
					errorCode: 'proxy_closed',
					errorMessage: 'Proxy closed before attach',
					errorDetails: { exitCode: 255 },
					updatedAt
				})
			)
		).resolves.toMatchObject({
			id: 'session-1',
			status: 'failed',
			endedAt,
			errorCode: 'proxy_closed',
			errorMessage: 'Proxy closed before attach',
			errorDetails: { exitCode: 255 },
			updatedAt
		});
		await expect(repository.getConnectionSession('session-1')).resolves.toMatchObject({
			status: 'failed',
			endedAt,
			updatedAt
		});
		await expect(repository.getConnectionSession('missing-session')).resolves.toBeNull();
		await expect(
			repository.listConnectionHistory('user-1', { status: 'failed', hostId: 'host-1' })
		).resolves.toEqual([
			expect.objectContaining({
				id: 'session-1',
				durationMs: 180000,
				errorReason: 'Proxy closed before attach'
			})
		]);
	});

	it('stores SSH tunnel and live session records with scoped update misses', async () => {
		expect.assertions(11);

		const repository = new InMemoryTermixServicesRepository();
		const updatedAt = new Date('2026-05-15T10:04:00.000Z');
		await repository.createWorkspace(workspace({ id: 'workspace-1' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'member-1', workspaceId: 'workspace-1', userId: 'member-1' })
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
				sshHostId: 'shared-host',
				targetHost: 'postgres.internal',
				targetPort: 5432
			})
		);
		await repository.createSshTunnelSession(
			sshTunnelSession({
				id: 'shared-tunnel-session',
				profileId: 'shared-profile',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				sshHostId: 'shared-host',
				status: 'starting'
			})
		);
		await repository.createSshLiveSession(
			sshLiveSession({
				id: 'live-session-1',
				userId: 'owner-1',
				hostId: 'shared-host',
				status: 'starting'
			})
		);
		await repository.createSshAttachTicket(
			sshAttachTicket({
				id: 'attach-ticket-1',
				userId: 'owner-1',
				sshLiveSessionId: 'live-session-1',
				ticketHash: 'attach-ticket-hash-1'
			})
		);

		await expect(repository.getSshTunnelProfile('member-1', 'private-profile')).resolves.toBeNull();
		await expect(
			repository.updateSshTunnelProfile('member-1', 'missing-profile', {
				name: 'Missing'
			})
		).resolves.toBeNull();
		await expect(
			repository.updateSshTunnelProfile('member-1', 'shared-profile', {
				name: 'Shared database tunnel',
				description: 'Operator approved database tunnel',
				updatedAt
			})
		).resolves.toMatchObject({
			id: 'shared-profile',
			userId: 'owner-1',
			name: 'Shared database tunnel',
			description: 'Operator approved database tunnel',
			updatedAt
		});
		await expect(
			repository.updateSshTunnelSession('outsider-1', 'shared-tunnel-session', {
				status: 'active'
			})
		).resolves.toBeNull();
		await expect(
			repository.updateSshTunnelSession('member-1', 'shared-tunnel-session', {
				status: 'active',
				lastSeenAt: updatedAt
			})
		).resolves.toMatchObject({
			id: 'shared-tunnel-session',
			userId: 'owner-1',
			status: 'active',
			lastSeenAt: updatedAt
		});
		await expect(
			repository.listSshTunnelSessions('member-1', {
				status: 'active',
				profileId: 'shared-profile'
			})
		).resolves.toEqual([expect.objectContaining({ id: 'shared-tunnel-session' })]);
		await expect(
			repository.updateSshLiveSession('member-1', 'live-session-1', {})
		).resolves.toBeNull();
		await expect(
			repository.updateSshLiveSession('owner-1', 'live-session-1', {
				status: 'attached',
				lastAttachedAt: updatedAt,
				terminalCols: 132,
				terminalRows: 43,
				updatedAt
			})
		).resolves.toMatchObject({
			id: 'live-session-1',
			status: 'attached',
			lastAttachedAt: updatedAt,
			terminalCols: 132,
			terminalRows: 43
		});
		await expect(
			repository.findReusableSshLiveSession('owner-1', 'shared-host')
		).resolves.toMatchObject({ id: 'live-session-1', status: 'attached' });
		await expect(
			repository.consumeSshAttachTicket('attach-ticket-hash-1', updatedAt)
		).resolves.toMatchObject({ id: 'attach-ticket-1', consumedAt: updatedAt });
		await expect(
			repository.consumeSshAttachTicket('attach-ticket-hash-1', updatedAt)
		).resolves.toBeNull();
	});

	it('returns false or null for deletion and update misses without disturbing existing rows', async () => {
		expect.assertions(10);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createWorkspace(workspace({ id: 'workspace-1' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'membership-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createHost(
			host({ id: 'host-1', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createCredential(
			credential({ id: 'credential-1', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createTicket(ticket({ id: 'ticket-1', hostId: 'host-1' }));

		await expect(
			repository.updateWorkspace('missing-workspace', { name: 'Missing' })
		).resolves.toBeNull();
		await expect(
			repository.updateWorkspaceMembership('workspace-1', 'missing-user', { role: 'owner' })
		).resolves.toBeNull();
		await expect(repository.deleteWorkspaceMembership('workspace-1', 'missing-user')).resolves.toBe(
			false
		);
		await expect(
			repository.updateHost('outsider-1', 'host-1', { name: 'Nope' })
		).resolves.toBeNull();
		await expect(repository.deleteHost('outsider-1', 'host-1')).resolves.toBe(false);
		await expect(
			repository.updateCredential('outsider-1', 'credential-1', { name: 'Nope' })
		).resolves.toBeNull();
		await expect(repository.deleteCredential('outsider-1', 'credential-1')).resolves.toBe(false);
		await expect(
			repository.consumeTicket('missing-ticket-hash', new Date('2026-05-15T10:05:00.000Z'))
		).resolves.toBeNull();
		await expect(repository.getHost('member-1', 'host-1')).resolves.toMatchObject({
			id: 'host-1',
			name: 'Shell'
		});
		await expect(repository.getTicketByHash('ticket-hash-1')).resolves.toMatchObject({
			id: 'ticket-1',
			hostId: 'host-1'
		});
	});
});

describe('In-memory V5/V6 repository resources', () => {
	it('stores terminal recordings with owner-scoped updates and filters', async () => {
		expect.assertions(5);

		const repository = new InMemoryV5ResourcesRepository();
		const endedAt = new Date('2026-05-15T10:06:00.000Z');
		const retentionExpiresAt = new Date('2026-06-15T10:06:00.000Z');
		await repository.createTerminalRecording(
			terminalRecording({
				id: 'recording-1',
				userId: 'user-1',
				hostId: 'host-1',
				connectionSessionId: 'connection-session-1',
				status: 'recording'
			})
		);
		await repository.createTerminalRecording(
			terminalRecording({
				id: 'recording-2',
				userId: 'user-2',
				hostId: 'host-1',
				status: 'completed'
			})
		);

		await expect(
			repository.updateTerminalRecording('user-2', 'recording-1', { status: 'failed' })
		).resolves.toBeNull();
		await expect(
			repository.updateTerminalRecording('user-1', 'recording-1', {
				status: 'completed',
				endedAt,
				retentionExpiresAt,
				metadata: { bytes: 8192 },
				updatedAt: endedAt
			})
		).resolves.toMatchObject({
			id: 'recording-1',
			status: 'completed',
			endedAt,
			retentionExpiresAt,
			metadata: { bytes: 8192 }
		});
		await expect(
			repository.listTerminalRecordings('user-1', { hostId: 'host-1' })
		).resolves.toEqual([expect.objectContaining({ id: 'recording-1' })]);
		await expect(
			repository.listTerminalRecordings('user-1', { status: 'recording' })
		).resolves.toEqual([]);
		await expect(
			repository.listTerminalRecordings('user-2', { status: 'completed' })
		).resolves.toEqual([expect.objectContaining({ id: 'recording-2' })]);
	});

	it('stores V6 automation, job reports, job events, policies, reasons, and host intelligence', async () => {
		expect.assertions(21);

		const repository = new InMemoryV6ResourcesRepository();
		const now = new Date('2026-05-15T10:00:00.000Z');
		await repository.createAutomationTemplate(
			automationTemplate({
				id: 'template-private',
				userId: 'user-1',
				workspaceId: null,
				visibility: 'private'
			})
		);
		await repository.createAutomationTemplate(
			automationTemplate({
				id: 'template-workspace',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				visibility: 'workspace',
				requiresApproval: true
			})
		);
		await repository.createBackgroundJobWithTargets(
			backgroundJob({
				id: 'job-1',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				templateId: 'template-workspace',
				reason: 'Patch approved CVE window'
			}),
			[
				jobTarget({ id: 'target-1', jobId: 'job-1', hostId: 'host-1' }),
				jobTarget({ id: 'target-2', jobId: 'job-1', hostId: 'host-2', status: 'queued' })
			]
		);

		await expect(repository.listAutomationTemplates('user-1')).resolves.toEqual([
			expect.objectContaining({ id: 'template-private' })
		]);
		await expect(repository.listAutomationTemplates('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: 'template-workspace', requiresApproval: true })
		]);
		await expect(repository.getAutomationTemplate('missing-template')).resolves.toBeNull();
		await expect(repository.listBackgroundJobs('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: 'job-1', reason: 'Patch approved CVE window' })
		]);
		await expect(
			repository.updateBackgroundJob('job-1', {
				status: 'running',
				startedAt: now,
				updatedAt: now
			})
		).resolves.toMatchObject({ id: 'job-1', status: 'running', startedAt: now });
		await expect(
			repository.updateBackgroundJob('missing-job', { status: 'failed' })
		).resolves.toBeNull();
		await expect(repository.listJobTargets('job-1')).resolves.toEqual([
			expect.objectContaining({ id: 'target-1' }),
			expect.objectContaining({ id: 'target-2' })
		]);
		await expect(
			repository.updateJobTarget('target-1', {
				status: 'succeeded',
				output: { stdout: 'ok' },
				updatedAt: now
			})
		).resolves.toMatchObject({ id: 'target-1', status: 'succeeded', output: { stdout: 'ok' } });
		await expect(
			repository.updateJobTarget('missing-target', { status: 'failed' })
		).resolves.toBeNull();
		await expect(
			repository.recordJobEvent(jobEvent({ id: 'event-1', jobId: 'job-1' }))
		).resolves.toMatchObject({
			id: 'event-1',
			code: 'job.started'
		});
		await expect(
			repository.createJobReport(jobReport({ id: 'report-1', jobId: 'job-1' }))
		).resolves.toMatchObject({
			id: 'report-1',
			format: 'json',
			storageKey: 'reports/job-1.json'
		});
		await expect(
			repository.upsertWorkspacePolicy(workspacePolicy({ workspaceId: 'workspace-1' }))
		).resolves.toMatchObject({
			workspaceId: 'workspace-1',
			capability: 'bulk_job',
			effect: 'approval_required',
			requireReason: true
		});
		await expect(repository.getWorkspacePolicy('workspace-1', 'bulk_job')).resolves.toMatchObject({
			effect: 'approval_required'
		});
		await expect(
			repository.createApprovalRequest(approvalRequest({ id: 'approval-1' }))
		).resolves.toMatchObject({
			id: 'approval-1',
			status: 'pending',
			reason: 'Patch approved CVE window'
		});
		await expect(
			repository.updateApprovalRequest('approval-1', {
				status: 'approved',
				decidedBy: 'owner-1',
				decisionReason: 'Reviewed target list',
				decidedAt: now,
				updatedAt: now
			})
		).resolves.toMatchObject({
			id: 'approval-1',
			status: 'approved',
			decisionReason: 'Reviewed target list'
		});
		await expect(
			repository.updateApprovalRequest('missing-approval', { status: 'rejected' })
		).resolves.toBeNull();
		await expect(
			repository.recordOperationReason(operationReason({ id: 'reason-1' }))
		).resolves.toMatchObject({
			id: 'reason-1',
			reason: 'Patch approved CVE window'
		});
		await expect(
			repository.upsertHostFacts(hostFacts({ hostId: 'host-1' }))
		).resolves.toMatchObject({
			hostId: 'host-1',
			osName: 'NixOS',
			serviceHints: [{ name: 'sshd', state: 'running' }]
		});
		await expect(
			repository.upsertHostHealth(hostHealth({ hostId: 'host-1' }))
		).resolves.toMatchObject({
			hostId: 'host-1',
			state: 'healthy',
			consecutiveFailures: 0
		});
		await expect(repository.listHostFacts(['host-1', 'missing-host'])).resolves.toEqual([
			expect.objectContaining({ hostId: 'host-1' })
		]);
		await expect(repository.listHostHealth(['host-1', 'missing-host'])).resolves.toEqual([
			expect.objectContaining({ hostId: 'host-1' })
		]);
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

function connectionSessionPatch(patch: ConnectionSessionPatch = {}): ConnectionSessionPatch {
	return patch;
}

function ticket(patch: Partial<SessionTicketRecord> = {}): SessionTicketRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'ticket-1',
		ticketHash: 'ticket-hash-1',
		userId: 'owner-1',
		hostId: 'host-1',
		protocol: 'ssh',
		target: 'ssh:shell.example.test:22',
		expiresAt: new Date('2026-05-15T10:05:00.000Z'),
		usedAt: null,
		createdAt: now,
		...patch
	};
}

function sshTunnelProfile(patch: Partial<SshTunnelProfileRecord> = {}): SshTunnelProfileRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'profile-1',
		userId: 'owner-1',
		workspaceId: null,
		sshHostId: 'host-1',
		name: 'Private service',
		targetHost: 'service.internal',
		targetPort: 443,
		description: null,
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function sshTunnelSession(patch: Partial<SshTunnelSessionRecord> = {}): SshTunnelSessionRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'tunnel-session-1',
		profileId: 'profile-1',
		userId: 'owner-1',
		workspaceId: null,
		sshHostId: 'host-1',
		targetHost: 'service.internal',
		targetPort: 443,
		publicPath: '/tunnels/tunnel-session-1',
		status: 'active',
		startedAt: now,
		endedAt: null,
		lastSeenAt: now,
		errorCode: null,
		errorMessage: null,
		...patch
	};
}

function sshLiveSession(patch: Partial<SshLiveSessionRecord> = {}): SshLiveSessionRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'live-session-1',
		userId: 'owner-1',
		hostId: 'host-1',
		title: 'Shell',
		status: 'attached',
		startedAt: now,
		lastAttachedAt: now,
		detachedAt: null,
		expiresAt: null,
		endedAt: null,
		errorCode: null,
		errorMessage: null,
		terminalCols: 120,
		terminalRows: 40,
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function sshAttachTicket(patch: Partial<SshAttachTicketRecord> = {}): SshAttachTicketRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'attach-ticket-1',
		userId: 'owner-1',
		sshLiveSessionId: 'live-session-1',
		ticketHash: 'attach-ticket-hash-1',
		expiresAt: new Date('2026-05-15T10:01:00.000Z'),
		consumedAt: null,
		createdAt: now,
		...patch
	};
}

function workspaceLayout(patch: Partial<WorkspaceLayoutRecord> = {}): WorkspaceLayoutRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'layout-1',
		userId: 'member-1',
		workspaceId: null,
		layoutKind: 'split',
		panes: [],
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

type DrizzleOperation = 'select' | 'insert' | 'update' | 'delete';

interface DrizzleMockCall {
	operation: DrizzleOperation;
	table: unknown;
	values?: unknown;
	where?: unknown;
	limit?: number;
	returning?: unknown;
}

interface DrizzleDbMockOptions {
	selectRows?: Map<unknown, unknown[]>;
	insertRows?: Map<unknown, unknown[][]>;
	updateRows?: Map<unknown, unknown[][]>;
	deleteRows?: Map<unknown, unknown[]>;
}

function createDrizzleDbMock(options: DrizzleDbMockOptions = {}): {
	database: TermixDb;
	calls: DrizzleMockCall[];
} {
	const calls: DrizzleMockCall[] = [];
	const insertRows = cloneRowQueues(options.insertRows);
	const updateRows = cloneRowQueues(options.updateRows);

	const database = {
		select: vi.fn(() => ({
			from: vi.fn((table: unknown) => {
				const call: DrizzleMockCall = { operation: 'select', table };
				calls.push(call);
				return {
					where: vi.fn((condition: unknown) => {
						call.where = condition;
						return awaitableRows(options.selectRows?.get(table) ?? [], call);
					})
				};
			})
		})),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((values: unknown) => {
				const call: DrizzleMockCall = { operation: 'insert', table, values };
				calls.push(call);
				return {
					returning: vi.fn((fields?: unknown) => {
						call.returning = fields;
						return Promise.resolve(takeQueuedRows(insertRows, table));
					})
				};
			})
		})),
		update: vi.fn((table: unknown) => ({
			set: vi.fn((values: unknown) => {
				const call: DrizzleMockCall = { operation: 'update', table, values };
				calls.push(call);
				return {
					where: vi.fn((condition: unknown) => {
						call.where = condition;
						return {
							returning: vi.fn((fields?: unknown) => {
								call.returning = fields;
								return Promise.resolve(takeQueuedRows(updateRows, table));
							})
						};
					})
				};
			})
		})),
		delete: vi.fn((table: unknown) => ({
			where: vi.fn((condition: unknown) => {
				const call: DrizzleMockCall = { operation: 'delete', table, where: condition };
				calls.push(call);
				return {
					returning: vi.fn((fields?: unknown) => {
						call.returning = fields;
						return Promise.resolve(options.deleteRows?.get(table) ?? []);
					})
				};
			})
		}))
	} as unknown as TermixDb;

	return { database, calls };
}

function awaitableRows(
	rows: unknown[],
	call: DrizzleMockCall
): {
	limit: (count: number) => Promise<unknown[]>;
	then: Promise<unknown[]>['then'];
} {
	const promise = Promise.resolve(rows);
	return {
		limit: vi.fn((count: number) => {
			call.limit = count;
			return Promise.resolve(rows.slice(0, count));
		}),
		then: promise.then.bind(promise)
	};
}

function cloneRowQueues(rowQueues?: Map<unknown, unknown[][]>): Map<unknown, unknown[][]> {
	return new Map([...(rowQueues?.entries() ?? [])].map(([table, rows]) => [table, [...rows]]));
}

function takeQueuedRows(rowQueues: Map<unknown, unknown[][]>, table: unknown): unknown[] {
	const queue = rowQueues.get(table);
	return queue?.shift() ?? [];
}

function operationCall(
	calls: DrizzleMockCall[],
	operation: DrizzleOperation,
	table: unknown,
	index = 0
): DrizzleMockCall {
	const call = calls.filter((item) => item.operation === operation && item.table === table)[index];
	if (!call) throw new Error(`Missing ${operation} call for mocked Drizzle table`);
	return call;
}

function terminalRecording(patch: Partial<TerminalRecordingRecord> = {}): TerminalRecordingRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'recording-1',
		userId: 'user-1',
		hostId: 'host-1',
		connectionSessionId: null,
		sshLiveSessionId: null,
		status: 'recording',
		storageKey: 'recordings/recording-1.cast',
		startedAt: now,
		endedAt: null,
		retentionExpiresAt: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function automationTemplate(
	patch: Partial<AutomationTemplateRecord> = {}
): AutomationTemplateRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'template-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'Patch hosts',
		kind: 'ssh_command',
		visibility: 'private',
		version: 1,
		description: null,
		definition: { command: 'true' },
		variables: [],
		isDangerous: false,
		requiresApproval: false,
		lastUsedAt: null,
		usageCount: 0,
		updatedBy: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function backgroundJob(patch: Partial<BackgroundJobRecord> = {}): BackgroundJobRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'job-1',
		userId: 'user-1',
		workspaceId: null,
		templateId: null,
		templateVersion: null,
		kind: 'bulk_ssh_command',
		status: 'pending',
		title: 'Patch hosts',
		request: { command: 'true' },
		targetCount: 2,
		completedCount: 0,
		failedCount: 0,
		skippedCount: 0,
		concurrencyLimit: 2,
		reason: null,
		cancellationRequestedAt: null,
		startedAt: null,
		finishedAt: null,
		retentionExpiresAt: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function jobTarget(patch: Partial<JobTargetRecord> = {}): JobTargetRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'target-1',
		jobId: 'job-1',
		hostId: 'host-1',
		status: 'pending',
		attempt: 0,
		maxAttempts: 1,
		startedAt: null,
		finishedAt: null,
		errorCode: null,
		errorMessage: null,
		output: {},
		report: {},
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function jobEvent(patch: Partial<JobEventRecord> = {}): JobEventRecord {
	return {
		id: 'event-1',
		jobId: 'job-1',
		targetId: null,
		severity: 'info',
		code: 'job.started',
		message: 'Job started',
		details: {},
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		...patch
	};
}

function jobReport(patch: Partial<JobReportRecord> = {}): JobReportRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'report-1',
		jobId: 'job-1',
		format: 'json',
		storageKey: 'reports/job-1.json',
		summary: { succeeded: 1, failed: 0 },
		generatedBy: 'user-1',
		generatedAt: now,
		expiresAt: null,
		metadata: {},
		createdAt: now,
		...patch
	};
}

function workspacePolicy(patch: Partial<WorkspacePolicyRecord> = {}): WorkspacePolicyRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'policy-1',
		workspaceId: 'workspace-1',
		capability: 'bulk_job',
		effect: 'approval_required',
		minimumRole: 'operator',
		maxTargets: 10,
		requireReason: true,
		settings: { approvers: ['owner-1'] },
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function approvalRequest(patch: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'approval-1',
		workspaceId: 'workspace-1',
		jobId: 'job-1',
		templateId: 'template-workspace',
		capability: 'bulk_job',
		status: 'pending',
		requestedBy: 'member-1',
		decidedBy: null,
		reason: 'Patch approved CVE window',
		decisionReason: null,
		requestedAt: now,
		decidedAt: null,
		expiresAt: new Date('2026-05-15T11:00:00.000Z'),
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function operationReason(patch: Partial<OperationReasonRecord> = {}): OperationReasonRecord {
	return {
		id: 'reason-1',
		workspaceId: 'workspace-1',
		userId: 'member-1',
		hostId: 'host-1',
		jobId: 'job-1',
		templateId: 'template-workspace',
		capability: 'bulk_job',
		reason: 'Patch approved CVE window',
		metadata: {},
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		...patch
	};
}

function hostFacts(patch: Partial<HostFactsRecord> = {}): HostFactsRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'facts-1',
		hostId: 'host-1',
		workspaceId: 'workspace-1',
		collectedBy: 'member-1',
		source: 'ssh',
		osName: 'NixOS',
		osVersion: '26.05',
		kernel: '6.16',
		uptimeSeconds: 3600,
		cpu: { cores: 8 },
		memory: { totalBytes: 34359738368 },
		disk: { rootFreeBytes: 1073741824 },
		serviceHints: [{ name: 'sshd', state: 'running' }],
		facts: { nixStore: true },
		collectedAt: now,
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function hostHealth(patch: Partial<HostHealthRecord> = {}): HostHealthRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'health-1',
		hostId: 'host-1',
		workspaceId: 'workspace-1',
		state: 'healthy',
		lastSuccessfulConnectionAt: now,
		lastFailedConnectionAt: null,
		consecutiveFailures: 0,
		failureReason: null,
		checkedAt: now,
		nextCheckAt: new Date('2026-05-15T10:05:00.000Z'),
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}
