import { describe, expect, it, vi } from 'vitest';
import * as dbSchema from '../../db/schema';
import { DrizzleTermixServicesRepository } from './index';
import {
	createDrizzleDbMock,
	credential,
	host,
	membership,
	operationCall,
	session,
	sshAttachTicket,
	sshLiveSession,
	sshTunnelProfile,
	sshTunnelSession,
	workspace,
	workspaceLayout
} from './repository-test-helpers';

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
