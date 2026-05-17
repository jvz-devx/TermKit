import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceValidationError } from '$lib/server/services/errors';
import { hashPassword } from '$lib/server/auth/password';
import { settingsService } from '$lib/server/services/settings';
import { sshLiveSessionService } from '$lib/server/services/ssh-live-sessions';
import { liveSshManager } from '$lib/server/ssh-live/manager';
import {
	createAdminUser,
	disableAdminUser,
	getAdminOverview,
	promoteAdminUser,
	terminateAdminLiveSshSession,
	terminateAdminSshTunnelSession
} from './admin.remote';

const db = vi.hoisted(() => ({
	delete: vi.fn(),
	insert: vi.fn(),
	select: vi.fn(),
	update: vi.fn()
}));

const appServer = vi.hoisted(() => ({
	event: {
		locals: { user: { id: 'admin-1', username: 'root', isAdmin: true } } as {
			user?: { id: string; username: string; isAdmin?: boolean };
		},
		url: new URL('https://termix.test/admin')
	},
	refresh: vi.fn()
}));

vi.mock('$app/server', () => {
	function remoteCallable(type: 'command' | 'query', fn: (input?: unknown) => unknown) {
		const wrapper = vi.fn((input?: unknown) => {
			const promise = Promise.resolve(fn(input)) as Promise<unknown> & { refresh: () => void };
			promise.refresh = appServer.refresh;
			return promise;
		});
		Object.defineProperty(wrapper, '__', { value: { type } });
		return wrapper;
	}

	return {
		getRequestEvent: () => appServer.event,
		query: (fn: () => unknown) => remoteCallable('query', fn),
		command: (_validation: unknown, fn: (input?: unknown) => unknown) =>
			remoteCallable('command', fn)
	};
});

vi.mock('$lib/server/db', () => ({ db }));
vi.mock('$lib/server/auth/password', () => ({
	hashPassword: vi.fn(async (value: string) => `hashed:${value}`)
}));
vi.mock('$lib/server/services/settings', () => ({
	settingsService: {
		getBasicAppSettings: vi.fn()
	}
}));
vi.mock('$lib/server/services/ssh-live-sessions', () => ({
	sshLiveSessionService: {
		close: vi.fn()
	}
}));
vi.mock('$lib/server/ssh-live/manager', () => ({
	liveSshManager: {
		close: vi.fn()
	}
}));

type Row = Record<string, unknown>;

const basicSettings = {
	ticketTtlSeconds: 120,
	terminalFontSize: 14,
	clipboardSync: true,
	rdpClipboard: {
		text: true,
		files: false,
		clientToRemote: true,
		remoteToClient: false,
		fileTransferSizeLimitMiB: 32
	},
	rdpDriveRedirection: false,
	rdpPerformancePreset: 'balanced',
	rdpAudioRedirection: false,
	rememberLastActiveTab: true
};

function adminEvent(user: { id: string; username: string; isAdmin?: boolean } | undefined) {
	appServer.event = {
		locals: user ? { user } : {},
		url: new URL('https://termix.test/admin')
	};
}

function chainFromRows(rows: Row[]) {
	return {
		from: vi.fn(async () => rows)
	};
}

function chainFromOrderRows(rows: Row[]) {
	return {
		from: vi.fn(() => ({
			orderBy: vi.fn(async () => rows)
		}))
	};
}

function chainFromWhereOrderRows(rows: Row[]) {
	return {
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				orderBy: vi.fn(async () => rows)
			}))
		}))
	};
}

function chainFromOrderLimitRows(rows: Row[]) {
	return {
		from: vi.fn(() => ({
			orderBy: vi.fn(() => ({
				limit: vi.fn(async () => rows)
			}))
		}))
	};
}

function chainFromWhereLimitRows(rows: Row[]) {
	return {
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn(async () => rows)
			}))
		}))
	};
}

function mockAdminOverviewSelects(rows: {
	users?: Row[];
	identities?: Row[];
	appSessions?: Row[];
	hosts?: Row[];
	credentials?: Row[];
	workspaces?: Row[];
	memberships?: Row[];
	liveSsh?: Row[];
	sshTunnels?: Row[];
	activeConnections?: Row[];
	connectionHistory?: Row[];
}) {
	db.select
		.mockReturnValueOnce(chainFromOrderRows(rows.users ?? []))
		.mockReturnValueOnce(chainFromRows(rows.identities ?? []))
		.mockReturnValueOnce(chainFromRows(rows.appSessions ?? []))
		.mockReturnValueOnce(chainFromRows(rows.hosts ?? []))
		.mockReturnValueOnce(chainFromRows(rows.credentials ?? []))
		.mockReturnValueOnce(chainFromRows(rows.workspaces ?? []))
		.mockReturnValueOnce(chainFromRows(rows.memberships ?? []))
		.mockReturnValueOnce(chainFromOrderRows(rows.liveSsh ?? []))
		.mockReturnValueOnce(chainFromWhereOrderRows(rows.sshTunnels ?? []))
		.mockReturnValueOnce(chainFromWhereOrderRows(rows.activeConnections ?? []))
		.mockReturnValueOnce(chainFromOrderLimitRows(rows.connectionHistory ?? []));
}

function mockEmptyOverviewRefresh() {
	mockAdminOverviewSelects({});
}

beforeEach(() => {
	vi.clearAllMocks();
	adminEvent({ id: 'admin-1', username: 'root', isAdmin: true });
	vi.mocked(settingsService.getBasicAppSettings).mockResolvedValue(basicSettings as never);
	db.insert.mockReturnValue({ values: vi.fn(async () => undefined) });
	db.update.mockReturnValue({
		set: vi.fn(() => ({
			where: vi.fn(async () => undefined)
		}))
	});
	db.delete.mockReturnValue({ where: vi.fn(async () => undefined) });
});

describe('admin remote authorization', () => {
	it('rejects unauthenticated overview reads before database access', async () => {
		adminEvent(undefined);

		await expect(getAdminOverview()).rejects.toMatchObject({ status: 401 });
		expect(db.select).not.toHaveBeenCalled();
	});

	it('rejects non-admin commands before validation or writes', async () => {
		adminEvent({ id: 'user-1', username: 'ada', isAdmin: false });

		await expect(promoteAdminUser('user-2')).rejects.toMatchObject({ status: 403 });
		expect(db.update).not.toHaveBeenCalled();
	});
});

describe('admin overview query', () => {
	it('summarizes users, workspaces, sessions, settings, activity, and history', async () => {
		const now = new Date('2026-05-15T10:00:00.000Z');
		const earlier = new Date('2026-05-14T09:00:00.000Z');
		const later = new Date('2026-05-15T09:30:00.000Z');
		const userRows = [
			{
				id: 'admin-1',
				username: 'root',
				isAdmin: true,
				disabledAt: null,
				createdAt: earlier,
				updatedAt: later
			},
			{
				id: 'user-1',
				username: 'ada',
				isAdmin: false,
				disabledAt: new Date('2026-05-15T08:00:00.000Z'),
				createdAt: earlier,
				updatedAt: later
			}
		];
		mockAdminOverviewSelects({
			users: userRows,
			identities: [
				{ userId: 'user-1', email: 'zeta@example.com' },
				{ userId: 'user-1', email: 'ada@example.com' },
				{ userId: 'admin-1', email: null }
			],
			appSessions: [
				{ userId: 'user-1', expiresAt: new Date('2030-05-15T11:00:00.000Z'), lastSeenAt: now },
				{ userId: 'user-1', expiresAt: new Date('2020-05-15T09:00:00.000Z'), lastSeenAt: earlier }
			],
			hosts: [
				{
					id: 'host-1',
					userId: 'user-1',
					workspaceId: 'workspace-1',
					name: 'SSH',
					hostname: 'ssh.internal',
					protocol: 'ssh',
					updatedAt: later
				},
				{
					id: 'host-2',
					userId: 'user-1',
					workspaceId: 'workspace-1',
					name: 'RDP',
					hostname: 'rdp.internal',
					protocol: 'rdp',
					updatedAt: earlier
				},
				{
					id: 'host-3',
					userId: 'admin-1',
					workspaceId: 'workspace-2',
					name: 'VNC',
					hostname: 'vnc.internal',
					protocol: 'vnc',
					updatedAt: earlier
				}
			],
			credentials: [
				{ id: 'cred-1', userId: 'user-1', workspaceId: 'workspace-1', updatedAt: later },
				{ id: 'cred-2', userId: 'admin-1', workspaceId: null, updatedAt: earlier }
			],
			workspaces: [
				{ id: 'workspace-1', name: 'Ops', createdAt: earlier, updatedAt: earlier },
				{ id: 'workspace-2', name: 'Lab', createdAt: earlier, updatedAt: earlier }
			],
			memberships: [
				{
					workspaceId: 'workspace-1',
					userId: 'user-1',
					role: 'owner',
					createdAt: earlier,
					updatedAt: later
				},
				{
					workspaceId: 'workspace-1',
					userId: 'admin-1',
					role: 'member',
					createdAt: earlier,
					updatedAt: earlier
				}
			],
			liveSsh: [
				{
					id: 'live-1',
					userId: 'user-1',
					hostId: 'host-1',
					title: 'Deploy',
					status: 'attached',
					startedAt: earlier,
					lastAttachedAt: later,
					detachedAt: null,
					expiresAt: null,
					endedAt: null,
					updatedAt: later
				},
				{
					id: 'live-ended',
					userId: 'user-1',
					hostId: 'host-1',
					title: 'Ended',
					status: 'ended',
					startedAt: earlier,
					lastAttachedAt: null,
					detachedAt: null,
					expiresAt: null,
					endedAt: later,
					updatedAt: later
				}
			],
			sshTunnels: [
				{
					id: 'tunnel-1',
					userId: 'user-1',
					sshHostId: 'host-1',
					status: 'idle',
					startedAt: earlier,
					lastSeenAt: later
				}
			],
			activeConnections: [
				{
					id: 'ftp-1',
					userId: 'user-1',
					hostId: 'host-1',
					protocol: 'ftps',
					status: 'active',
					startedAt: earlier,
					endedAt: null,
					errorCode: null,
					updatedAt: later
				},
				{
					id: 'rdp-active',
					userId: 'user-1',
					hostId: 'host-2',
					protocol: 'rdp',
					status: 'active',
					startedAt: earlier,
					endedAt: null,
					errorCode: null,
					updatedAt: later
				}
			],
			connectionHistory: [
				{
					id: 'history-1',
					userId: 'user-1',
					hostId: 'host-2',
					protocol: 'rdp',
					status: 'failed',
					startedAt: earlier,
					endedAt: later,
					errorCode: 'rdp_gateway_timeout',
					updatedAt: later
				},
				{
					id: 'history-2',
					userId: 'missing-user',
					hostId: null,
					protocol: 'ssh',
					status: 'ended',
					startedAt: earlier,
					endedAt: later,
					errorCode: 'operator_terminated',
					updatedAt: later
				}
			]
		});

		const overview = await getAdminOverview();

		expect(overview.settings).toEqual(basicSettings);
		expect(overview.capabilities).toMatchObject({
			createUsers: true,
			disableUsers: true,
			promoteUsers: true,
			terminateLiveSshSessions: true,
			workspacesSource: 'workspace'
		});
		expect(overview.users).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'user-1',
					disabled: true,
					identityEmails: ['ada@example.com', 'zeta@example.com'],
					activeAppSessions: 1,
					hostCount: 2,
					credentialCount: 1,
					liveSshSessionCount: 1,
					lastSeenAt: '2026-05-15T10:00:00.000Z'
				})
			])
		);
		expect(overview.workspaces).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'workspace-1',
					ownerId: 'user-1',
					ownerUsername: 'ada',
					memberCount: 2,
					hostCount: 2,
					sshHosts: 1,
					rdpHosts: 1,
					credentialCount: 1,
					activeLiveSshSessions: 1,
					updatedAt: '2026-05-15T09:30:00.000Z'
				}),
				expect.objectContaining({
					id: 'workspace-2',
					ownerUsername: 'Unknown owner',
					vncHosts: 1
				})
			])
		);
		expect(overview.liveSshSessions).toEqual([
			expect.objectContaining({
				id: 'live-1',
				username: 'ada',
				hostName: 'SSH',
				canTerminate: true
			}),
			expect.objectContaining({
				id: 'live-ended',
				canTerminate: false
			})
		]);
		expect(overview.sshTunnels).toEqual([
			expect.objectContaining({
				id: 'tunnel-1',
				username: 'ada',
				hostName: 'SSH',
				status: 'idle',
				canTerminate: true
			})
		]);
		expect(overview.fileTransferActivity).toEqual([
			expect.objectContaining({
				id: 'ftp-1',
				protocol: 'ftps',
				status: 'active',
				hostName: 'SSH'
			})
		]);
		expect(overview.connectionHistory).toEqual([
			expect.objectContaining({
				id: 'history-1',
				failureReason: expect.objectContaining({
					category: 'timeout',
					message: 'Connection timed out for rdp'
				})
			}),
			expect.objectContaining({
				id: 'history-2',
				username: 'Unknown user',
				failureReason: expect.objectContaining({ category: 'operator' })
			})
		]);
		expect(settingsService.getBasicAppSettings).toHaveBeenCalledOnce();
	});
});

describe('admin user commands', () => {
	it('validates user creation before hashing or inserting', async () => {
		await expect(createAdminUser({ username: ' ', password: 'short' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);

		expect(hashPassword).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('creates local users with trimmed usernames and refreshes the overview', async () => {
		const values = vi.fn(async () => undefined);
		db.insert.mockReturnValueOnce({ values });
		mockEmptyOverviewRefresh();

		await expect(
			createAdminUser({ username: '  ada  ', password: 'correct-password', isAdmin: true })
		).resolves.toBe(undefined);

		expect(hashPassword).toHaveBeenCalledWith('correct-password');
		expect(values).toHaveBeenCalledWith({
			username: 'ada',
			passwordHash: 'hashed:correct-password',
			isAdmin: true
		});
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('promotes selected users and refreshes the overview', async () => {
		const where = vi.fn(async () => undefined);
		const set = vi.fn(() => ({ where }));
		db.update.mockReturnValueOnce({ set });
		mockEmptyOverviewRefresh();

		await expect(promoteAdminUser('user-1')).resolves.toBe(undefined);

		expect(set).toHaveBeenCalledWith({ isAdmin: true, updatedAt: expect.any(Date) });
		expect(where).toHaveBeenCalledOnce();
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('blocks self-disable before touching user or session state', async () => {
		await expect(disableAdminUser('admin-1')).rejects.toBeInstanceOf(ServiceValidationError);

		expect(db.update).not.toHaveBeenCalled();
		expect(db.delete).not.toHaveBeenCalled();
	});

	it('disables users, revokes their app sessions, and refreshes the overview', async () => {
		const updateWhere = vi.fn(async () => undefined);
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		const deleteWhere = vi.fn(async () => undefined);
		db.update.mockReturnValueOnce({ set: updateSet });
		db.delete.mockReturnValueOnce({ where: deleteWhere });
		mockEmptyOverviewRefresh();

		await expect(disableAdminUser('user-1')).resolves.toBe(undefined);

		expect(updateSet).toHaveBeenCalledWith({
			disabledAt: expect.any(Date),
			updatedAt: expect.any(Date)
		});
		expect(updateWhere).toHaveBeenCalledOnce();
		expect(deleteWhere).toHaveBeenCalledOnce();
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});
});

describe('admin session termination commands', () => {
	it('validates live SSH termination ids before selecting sessions', async () => {
		await expect(terminateAdminLiveSshSession('')).rejects.toBeInstanceOf(ServiceValidationError);

		expect(db.select).not.toHaveBeenCalled();
		expect(sshLiveSessionService.close).not.toHaveBeenCalled();
	});

	it('rejects inactive live SSH termination requests', async () => {
		db.select.mockReturnValueOnce(chainFromWhereLimitRows([]));

		await expect(terminateAdminLiveSshSession('live-ended')).rejects.toBeInstanceOf(
			ServiceValidationError
		);

		expect(sshLiveSessionService.close).not.toHaveBeenCalled();
		expect(liveSshManager.close).not.toHaveBeenCalled();
	});

	it('closes active live SSH sessions through the service and manager', async () => {
		db.select.mockReturnValueOnce(chainFromWhereLimitRows([{ id: 'live-1', userId: 'user-1' }]));
		mockEmptyOverviewRefresh();

		await expect(terminateAdminLiveSshSession('live-1')).resolves.toBe(undefined);

		expect(sshLiveSessionService.close).toHaveBeenCalledWith('user-1', 'live-1');
		expect(liveSshManager.close).toHaveBeenCalledWith('live-1');
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('rejects inactive SSH tunnel termination requests', async () => {
		db.select.mockReturnValueOnce(chainFromWhereLimitRows([{ id: 'tunnel-1', status: 'ended' }]));

		await expect(terminateAdminSshTunnelSession('tunnel-1')).rejects.toBeInstanceOf(
			ServiceValidationError
		);

		expect(db.update).not.toHaveBeenCalled();
	});

	it('ends active SSH tunnels and matching connection session history', async () => {
		const updateWhere = vi.fn(async () => undefined);
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		db.select.mockReturnValueOnce(chainFromWhereLimitRows([{ id: 'tunnel-1', status: 'active' }]));
		db.update.mockReturnValue({ set: updateSet });
		mockEmptyOverviewRefresh();

		await expect(terminateAdminSshTunnelSession('tunnel-1')).resolves.toBe(undefined);

		expect(updateSet).toHaveBeenCalledWith({
			status: 'ended',
			endedAt: expect.any(Date),
			lastSeenAt: expect.any(Date),
			errorCode: null
		});
		expect(updateSet).toHaveBeenCalledWith({
			status: 'ended',
			endedAt: expect.any(Date),
			errorCode: null,
			updatedAt: expect.any(Date)
		});
		expect(updateWhere).toHaveBeenCalledTimes(2);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});
});
