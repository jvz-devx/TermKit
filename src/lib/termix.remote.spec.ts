import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { credentialService } from '$lib/server/services/credentials';
import { hostService } from '$lib/server/services/hosts';
import { sessionTicketService } from '$lib/server/services/session-tickets';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { settingsService } from '$lib/server/services/settings';
import { termixRepository } from '$lib/server/services/repository';
import { resolveVncLaunchCredentials } from '$lib/server/protocols/vnc';
import {
	createSessionLaunch,
	listConnectionHistory,
	listCredentials,
	listHosts,
	recordConnectionSessionLifecycle,
	saveCredential,
	saveHost,
	saveSessionWorkspaceLayout
} from './termix.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: { user: { id: 'user-1', username: 'ada' } } as {
			user?: { id: string; username: string };
		},
		url: new URL('https://termix.test/termix')
	},
	refresh: vi.fn()
}));

const ticketConsumerMocks = vi.hoisted(() => ({
	consume: vi.fn()
}));

const rdpGatewayMocks = vi.hoisted(() => ({
	bootstrap: vi.fn()
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

vi.mock('$lib/server/services/hosts', () => ({
	hostService: {
		list: vi.fn(),
		get: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	}
}));

vi.mock('$lib/server/services/credentials', () => ({
	credentialService: {
		list: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	}
}));

vi.mock('$lib/server/services/session-tickets', () => ({
	sessionTicketService: {
		create: vi.fn()
	},
	parseSessionTicketTargetSnapshot: vi.fn((record: { target: string }) => JSON.parse(record.target))
}));

vi.mock('$lib/server/rdp/gateway', () => ({
	RdpGatewayBootstrapper: vi.fn(() => ({
		bootstrap: rdpGatewayMocks.bootstrap
	}))
}));

vi.mock('$lib/server/ws/ticket-consumer', () => ({
	SessionTicketConsumer: vi.fn(() => ({
		consume: ticketConsumerMocks.consume
	}))
}));

vi.mock('$lib/server/protocols/vnc', () => ({
	resolveVncLaunchCredentials: vi.fn()
}));

vi.mock('$lib/server/protocols/rdp-credentials', () => ({
	resolveRdpLaunchCredentials: vi.fn()
}));

vi.mock('$lib/server/services/connection-sessions', () => ({
	connectionSessionService: {
		listHistory: vi.fn(),
		start: vi.fn(),
		markActive: vi.fn(),
		markActiveForUser: vi.fn(),
		endForUser: vi.fn(),
		failForUser: vi.fn(),
		fail: vi.fn()
	}
}));

vi.mock('$lib/server/services/settings', () => ({
	settingsService: {
		getBasicAppSettings: vi.fn()
	}
}));

vi.mock('$lib/server/services/repository', () => ({
	termixRepository: {
		listWorkspaceLayouts: vi.fn(),
		createWorkspaceLayout: vi.fn(),
		updateWorkspaceLayout: vi.fn()
	}
}));

vi.mock('$lib/server/services/ssh-live-sessions', () => ({
	sshLiveSessionService: {
		listVisible: vi.fn(),
		createOrReuse: vi.fn(),
		get: vi.fn(),
		rename: vi.fn(),
		close: vi.fn(),
		createAttachTicket: vi.fn()
	}
}));

vi.mock('$lib/server/services/ssh-tunnels', () => ({
	publicSshTunnelPath: (sessionId: string) => `/tunnels/${encodeURIComponent(sessionId)}`,
	sshTunnelService: {
		listProfiles: vi.fn(),
		listSessions: vi.fn(),
		saveProfile: vi.fn(),
		deleteProfile: vi.fn(),
		startSession: vi.fn(),
		inspectSession: vi.fn(),
		terminateSession: vi.fn(),
		failSession: vi.fn()
	}
}));

vi.mock('$lib/server/ssh-live/manager', () => ({
	liveSshManager: {
		close: vi.fn()
	}
}));

vi.mock('$lib/server/protocols/ssh-host-key-enrollment', () => ({
	enrollSshHostKey: vi.fn(),
	getSshHostKeyTrustSummary: vi.fn()
}));

describe('termix remote functions', () => {
	const now = new Date('2026-05-15T10:00:00.000Z');

	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: { user: { id: 'user-1', username: 'ada' } },
			url: new URL('https://termix.test/termix')
		};
		vi.mocked(hostService.list).mockResolvedValue([]);
		vi.mocked(credentialService.list).mockResolvedValue([]);
		vi.mocked(settingsService.getBasicAppSettings).mockResolvedValue({
			ticketTtlSeconds: 60
		} as never);
		vi.mocked(termixRepository.listWorkspaceLayouts).mockResolvedValue([]);
	});

	it('rejects host inventory without invoking services when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/termix')
		};

		await expect(listHosts()).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(hostService.list).not.toHaveBeenCalled();
		expect(credentialService.list).not.toHaveBeenCalled();
	});

	it('lists hosts with credential names and stable date serialization', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			hostRecord({ id: 'host-b', name: 'Zulu', credentialId: null }),
			hostRecord({ id: 'host-a', name: 'Alpha', credentialId: 'cred-1' })
		] as never);
		vi.mocked(credentialService.list).mockResolvedValueOnce([
			credentialRecord({ id: 'cred-1', name: 'Production SSH' })
		] as never);

		const hosts = await listHosts();

		expect(hosts.map((host) => host.name)).toEqual(['Alpha', 'Zulu']);
		expect(hosts[0]).toMatchObject({
			id: 'host-a',
			credentialName: 'Production SSH',
			createdAt: now.toISOString(),
			updatedAt: now.toISOString()
		});
		expect(hosts[0]).not.toHaveProperty('secret');
		expect(hosts[0]).not.toHaveProperty('encryptedSecret');
	});

	it('normalizes host mutations before delegating to host service', async () => {
		vi.mocked(hostService.create).mockResolvedValueOnce(
			hostRecord({ id: 'host-new', name: 'API', credentialId: null, tags: ['prod', 'eu'] }) as never
		);

		const host = await saveHost({
			name: 'API',
			protocol: 'ssh',
			hostname: 'api.internal',
			port: 22,
			credentialId: 'none',
			tags: 'prod, eu, ,'
		});

		expect(hostService.create).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				credentialId: null,
				tags: ['prod', 'eu']
			})
		);
		expect(host).toMatchObject({ id: 'host-new', credentialName: null, tags: ['prod', 'eu'] });
		expect(appServer.refresh).toHaveBeenCalledTimes(2);
	});

	it('lists credential summaries without returning stored or submitted secrets', async () => {
		vi.mocked(credentialService.list).mockResolvedValueOnce([
			credentialRecord({
				id: 'cred-1',
				name: 'Shared password',
				encryptedSecret: 'encrypted-secret'
			})
		] as never);
		vi.mocked(hostService.list).mockResolvedValueOnce([
			hostRecord({ id: 'host-1', credentialId: 'cred-1' }),
			hostRecord({ id: 'host-2', credentialId: 'cred-1' })
		] as never);

		const credentials = await listCredentials();

		expect(credentials).toEqual([
			expect.objectContaining({
				id: 'cred-1',
				name: 'Shared password',
				usedBy: 2
			})
		]);
		expect(credentials[0]).not.toHaveProperty('secret');
		expect(credentials[0]).not.toHaveProperty('encryptedSecret');
	});

	it('passes credential secrets only into the mutation service and redacts the response', async () => {
		vi.mocked(credentialService.create).mockResolvedValueOnce(
			credentialRecord({
				id: 'cred-new',
				name: 'API password',
				encryptedSecret: 'ciphertext'
			}) as never
		);

		const credential = await saveCredential({
			name: 'API password',
			kind: 'password',
			username: 'deploy',
			secret: 'plain-secret'
		});

		expect(credentialService.create).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({ secret: 'plain-secret' })
		);
		expect(credential).toMatchObject({
			id: 'cred-new',
			name: 'API password',
			kind: 'password',
			username: 'deploy'
		});
		expect(credential).not.toHaveProperty('secret');
		expect(credential).not.toHaveProperty('encryptedSecret');
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('blocks SFTP launches for non-SSH hosts before starting a connection session', async () => {
		vi.mocked(hostService.get).mockResolvedValueOnce(hostRecord({ protocol: 'rdp' }) as never);

		await expect(
			createSessionLaunch({ hostId: 'host-1', protocol: 'sftp' })
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(connectionSessionService.start).not.toHaveBeenCalled();
	});

	it('creates policy-checked SFTP launches without exposing transport tickets', async () => {
		vi.mocked(hostService.get).mockResolvedValueOnce(hostRecord({ protocol: 'ssh' }) as never);
		vi.mocked(connectionSessionService.start).mockResolvedValueOnce({
			id: 'connection-1'
		} as never);
		vi.mocked(connectionSessionService.markActive).mockResolvedValueOnce({
			id: 'connection-1'
		} as never);

		const launch = await createSessionLaunch({ hostId: 'host-1', protocol: 'sftp' });

		expect(connectionSessionService.start).toHaveBeenCalledWith({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh'
		});
		expect(launch).toMatchObject({
			hostId: 'host-1',
			protocol: 'sftp',
			ticket: null,
			websocketPath: null,
			connectionSessionId: 'connection-1'
		});
	});

	it('creates VNC launch tickets and keeps saved credentials launch-scoped', async () => {
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'opaque-ticket',
			record: {
				hostId: 'host-1',
				protocol: 'vnc',
				expiresAt: new Date('2026-05-15T10:01:00.000Z'),
				target: JSON.stringify({ host: { credentialId: 'cred-1' } })
			}
		} as never);
		vi.mocked(resolveVncLaunchCredentials).mockResolvedValueOnce({
			username: 'viewer',
			password: 'launch-secret',
			source: 'saved-password',
			unavailableReason: null
		} as never);

		const launch = await createSessionLaunch({ hostId: 'host-1', protocol: 'vnc' });

		expect(sessionTicketService.create).toHaveBeenCalledWith('user-1', {
			hostId: 'host-1',
			protocol: 'vnc',
			ttlMs: 60_000
		});
		expect(launch).toMatchObject({
			hostId: 'host-1',
			protocol: 'vnc',
			ticket: 'opaque-ticket',
			websocketPath: '/ws/vnc/opaque-ticket',
			vncCredentials: {
				username: 'viewer',
				password: 'launch-secret',
				source: 'saved-password'
			}
		});
		expect(launch).not.toHaveProperty('target');
		expect(launch).not.toHaveProperty('encryptedSecret');
	});

	it('summarizes connection history with deleted-resource fallbacks', async () => {
		vi.mocked(connectionSessionService.listHistory).mockResolvedValueOnce([
			{
				id: 'history-1',
				userId: 'user-1',
				username: null,
				workspaceId: null,
				workspaceName: null,
				hostId: null,
				hostName: null,
				hostname: null,
				hostUsername: null,
				protocol: 'ssh',
				startedAt: now,
				endedAt: null,
				durationMs: null,
				status: 'failed',
				errorReason: 'connection refused',
				errorCode: 'ssh_failed',
				errorMessage: null,
				errorDetails: null
			}
		] as never);

		await expect(listConnectionHistory()).resolves.toEqual([
			expect.objectContaining({
				id: 'history-1',
				user: 'Unknown user',
				workspace: 'Personal workspace',
				host: 'Deleted host',
				hostname: 'Unknown host',
				startedAt: now.toISOString(),
				status: 'failed',
				errorReason: 'connection refused'
			})
		]);
		expect(connectionSessionService.listHistory).toHaveBeenCalledWith('user-1');
	});

	it('validates workspace layout metadata before repository writes', async () => {
		await expect(
			saveSessionWorkspaceLayout({
				metadata: { layout: 'stacked', panes: [{ id: 'pane-1' }] }
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(termixRepository.createWorkspaceLayout).not.toHaveBeenCalled();
		expect(termixRepository.updateWorkspaceLayout).not.toHaveBeenCalled();
	});

	it('creates the first session workspace layout and refreshes the query', async () => {
		vi.mocked(termixRepository.createWorkspaceLayout).mockImplementationOnce(async (input) => ({
			...input,
			layoutKind: 'two-columns',
			panes: [{ id: 'left' }, { id: 'right' }],
			createdAt: now,
			updatedAt: now
		})) as never;

		const layout = await saveSessionWorkspaceLayout({
			metadata: { layout: 'two-columns', panes: [{ id: 'left' }, { id: 'right' }] }
		});

		expect(termixRepository.createWorkspaceLayout).toHaveBeenCalledWith(
			expect.objectContaining({
				id: expect.any(String),
				userId: 'user-1',
				workspaceId: null,
				layoutKind: 'two-columns',
				panes: [{ id: 'left' }, { id: 'right' }]
			})
		);
		expect(layout).toEqual({
			layout: 'two-columns',
			panes: [{ id: 'left' }, { id: 'right' }],
			updatedAt: now.toISOString()
		});
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('records failed connection lifecycle events with sanitized error codes', async () => {
		vi.mocked(connectionSessionService.failForUser).mockResolvedValueOnce({
			id: 'connection-1'
		} as never);

		await expect(
			recordConnectionSessionLifecycle({
				connectionSessionId: 'connection-1',
				event: 'failed',
				errorCode: 'SSH Auth Failed!'
			})
		).resolves.toBe(undefined);
		expect(connectionSessionService.failForUser).toHaveBeenCalledWith(
			'user-1',
			'connection-1',
			'ssh_auth_failed_'
		);
	});
});

function hostRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'host-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'SSH Host',
		protocol: 'ssh',
		hostname: 'ssh.internal',
		port: 22,
		username: 'deploy',
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		metadata: {},
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		updatedAt: new Date('2026-05-15T10:00:00.000Z'),
		...overrides
	};
}

function credentialRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'cred-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'SSH key',
		kind: 'password',
		username: 'deploy',
		encryptedSecret: 'encrypted',
		encryption: { algorithm: 'aes-256-gcm' },
		metadata: {},
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		updatedAt: new Date('2026-05-15T10:00:00.000Z'),
		...overrides
	};
}
