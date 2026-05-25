import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { credentialService } from '$lib/server/services/credentials';
import { hostService } from '$lib/server/services/hosts';
import { sessionTicketService } from '$lib/server/services/session-tickets';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { settingsService } from '$lib/server/services/settings';
import { termixRepository } from '$lib/server/services/repository';
import { hostGroupsByHostId, setHostGroupIdsForHost } from '$lib/server/services/host-groups';
import { resolveVncLaunchCredentials } from '$lib/server/protocols/vnc';
import { resolveRdpLaunchCredentials } from '$lib/server/protocols/rdp-credentials';
import { getSshHostKeyTrustSummary } from '$lib/server/protocols/ssh-host-key-enrollment';
import { sshLiveSessionService } from '$lib/server/services/ssh-live-sessions';
import { liveSshManager } from '$lib/server/ssh-live/manager';
import {
	attachLiveSshSession,
	closeLiveSshSession,
	createLiveSshSession,
	createSessionLaunch,
	listConnectionHistory,
	listCredentials,
	listHosts,
	recordConnectionSessionLifecycle,
	recordRdpSessionLifecycle,
	renameLiveSshSession,
	saveCredential,
	saveHost,
	saveSessionWorkspaceLayout
} from './termix-core.remote';
import {
	credentialRecord,
	hostRecord,
	liveSshSessionRecord,
	sshHostKeyTrustSummary
} from './termix-core.remote-test-helpers';

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
	RdpGatewayBootstrapper: vi.fn(function () {
		return {
			bootstrap: rdpGatewayMocks.bootstrap
		};
	})
}));

vi.mock('$lib/server/ws/ticket-consumer', () => ({
	SessionTicketConsumer: vi.fn(function () {
		return {
			consume: ticketConsumerMocks.consume
		};
	})
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
		failForUserWithDetails: vi.fn(),
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

vi.mock('$lib/server/services/host-groups', () => ({
	hostGroupsByHostId: vi.fn(),
	setHostGroupIdsForHost: vi.fn()
}));

vi.mock('$lib/server/services/ssh-live-sessions', () => ({
	sshLiveSessionService: {
		listVisible: vi.fn(),
		createOrReuse: vi.fn(),
		get: vi.fn(),
		prepareAttach: vi.fn(),
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
		vi.mocked(getSshHostKeyTrustSummary).mockResolvedValue(sshHostKeyTrustSummary() as never);
		vi.mocked(termixRepository.listWorkspaceLayouts).mockResolvedValue([]);
		vi.mocked(hostGroupsByHostId).mockResolvedValue(new Map() as never);
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
		const productionGroup = {
			id: 'group-1',
			name: 'Production',
			hostCount: 2,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString()
		};
		vi.mocked(hostService.list).mockResolvedValueOnce([
			hostRecord({ id: 'host-b', name: 'Zulu', credentialId: null }),
			hostRecord({ id: 'host-a', name: 'Alpha', credentialId: 'cred-1' })
		] as never);
		vi.mocked(credentialService.list).mockResolvedValueOnce([
			credentialRecord({ id: 'cred-1', name: 'Production SSH' })
		] as never);
		vi.mocked(hostGroupsByHostId).mockResolvedValueOnce(
			new Map([['host-a', [productionGroup]]]) as never
		);

		const hosts = await listHosts();

		expect(hosts.map((host) => host.name)).toEqual(['Alpha', 'Zulu']);
		expect(hostGroupsByHostId).toHaveBeenCalledWith('user-1');
		expect(hosts[0]).toMatchObject({
			id: 'host-a',
			credentialName: 'Production SSH',
			groups: [productionGroup],
			hostKeyTrust: {
				status: 'pinned',
				fingerprint: 'SHA256:test'
			},
			createdAt: now.toISOString(),
			updatedAt: now.toISOString()
		});
		expect(hosts[0]).not.toHaveProperty('secret');
		expect(hosts[0]).not.toHaveProperty('encryptedSecret');
		expect(getSshHostKeyTrustSummary).toHaveBeenCalledWith('user-1', 'host-a');
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
			groupIds: ['group-1', 42],
			tags: 'prod, eu, ,'
		});

		expect(hostService.create).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				credentialId: null,
				tags: ['prod', 'eu']
			})
		);
		expect(setHostGroupIdsForHost).toHaveBeenCalledWith('user-1', 'host-new', ['group-1']);
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

	it('requires a host id before launch policy or ticket work', async () => {
		await expect(createSessionLaunch({ protocol: 'ssh' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(hostService.get).not.toHaveBeenCalled();
		expect(sessionTicketService.create).not.toHaveBeenCalled();
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
			protocol: 'sftp'
		});
		expect(launch).toMatchObject({
			hostId: 'host-1',
			protocol: 'sftp',
			ticket: null,
			websocketPath: null,
			connectionSessionId: 'connection-1'
		});
	});

	it('rejects SFTP launches when the connection session cannot be activated', async () => {
		vi.mocked(hostService.get).mockResolvedValueOnce(hostRecord({ protocol: 'ssh' }) as never);
		vi.mocked(connectionSessionService.start).mockResolvedValueOnce({
			id: 'connection-1'
		} as never);
		vi.mocked(connectionSessionService.markActive).mockResolvedValueOnce(null as never);

		await expect(
			createSessionLaunch({ hostId: 'host-1', protocol: 'sftp' })
		).rejects.toBeInstanceOf(ServiceValidationError);
	});

	it.each(['ftp', 'ftps'] as const)(
		'creates policy-checked %s launches without transport tickets',
		async (protocol) => {
			vi.mocked(hostService.get).mockResolvedValueOnce(hostRecord({ protocol }) as never);
			vi.mocked(connectionSessionService.start).mockResolvedValueOnce({
				id: `${protocol}-connection`
			} as never);
			vi.mocked(connectionSessionService.markActive).mockResolvedValueOnce({
				id: `${protocol}-connection`
			} as never);

			const launch = await createSessionLaunch({ hostId: 'host-1', protocol });

			expect(connectionSessionService.start).toHaveBeenCalledWith({
				userId: 'user-1',
				hostId: 'host-1',
				protocol
			});
			expect(launch).toMatchObject({
				hostId: 'host-1',
				protocol,
				ticket: null,
				websocketPath: null,
				connectionSessionId: `${protocol}-connection`
			});
		}
	);

	it.each([
		['ftp', 'ftps'],
		['ftps', 'ftp']
	] as const)('blocks %s launches for %s hosts', async (protocol, hostProtocol) => {
		vi.mocked(hostService.get).mockResolvedValueOnce(
			hostRecord({ protocol: hostProtocol }) as never
		);

		await expect(createSessionLaunch({ hostId: 'host-1', protocol })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(connectionSessionService.start).not.toHaveBeenCalled();
	});

	it('rejects FTP launches when the connection session cannot be activated', async () => {
		vi.mocked(hostService.get).mockResolvedValueOnce(hostRecord({ protocol: 'ftp' }) as never);
		vi.mocked(connectionSessionService.start).mockResolvedValueOnce({
			id: 'ftp-connection'
		} as never);
		vi.mocked(connectionSessionService.markActive).mockResolvedValueOnce(null as never);

		await expect(createSessionLaunch({ hostId: 'host-1', protocol: 'ftp' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
	});

	it.each(['ssh', 'telnet'] as const)(
		'creates %s launch tickets for websocket protocols',
		async (protocol) => {
			vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
				ticket: `${protocol}-ticket`,
				record: {
					hostId: 'host-1',
					protocol,
					expiresAt: new Date('2026-05-15T10:01:00.000Z'),
					target: JSON.stringify({ host: { credentialId: null, username: 'operator' } })
				}
			} as never);

			const launch = await createSessionLaunch({ hostId: 'host-1', protocol });

			expect(sessionTicketService.create).toHaveBeenCalledWith('user-1', {
				hostId: 'host-1',
				protocol,
				ttlMs: 60_000
			});
			expect(launch).toMatchObject({
				hostId: 'host-1',
				protocol,
				ticket: `${protocol}-ticket`,
				websocketPath: `/ws/${protocol}/${protocol}-ticket`,
				connectionSessionId: null,
				rdp: null,
				rdpCredentials: null,
				vncCredentials: null
			});
		}
	);

	it('propagates invalid launch protocol validation from the ticket service', async () => {
		vi.mocked(sessionTicketService.create).mockRejectedValueOnce(
			new ServiceValidationError(['protocol is invalid'])
		);

		await expect(
			createSessionLaunch({ hostId: 'host-1', protocol: 'smtp' })
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(sessionTicketService.create).toHaveBeenCalledWith('user-1', {
			hostId: 'host-1',
			protocol: 'smtp',
			ttlMs: 60_000
		});
		expect(connectionSessionService.start).not.toHaveBeenCalled();
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

	it('returns VNC username fallback when no saved credential is required', async () => {
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'vnc-ticket',
			record: {
				hostId: 'host-1',
				protocol: 'vnc',
				expiresAt: new Date('2026-05-15T10:01:00.000Z'),
				target: JSON.stringify({ host: { credentialId: null, username: 'viewer' } })
			}
		} as never);
		vi.mocked(resolveVncLaunchCredentials).mockResolvedValueOnce({
			username: 'viewer',
			password: null,
			source: 'none',
			unavailableReason: null
		} as never);

		const launch = await createSessionLaunch({ hostId: 'host-1', protocol: 'vnc' });

		expect(launch.vncCredentials).toEqual({
			username: 'viewer',
			password: null,
			source: 'none',
			unavailableReason: null
		});
	});

	it('propagates VNC credential unavailable errors without opening a connection session', async () => {
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'vnc-ticket',
			record: {
				hostId: 'host-1',
				protocol: 'vnc',
				expiresAt: new Date('2026-05-15T10:01:00.000Z'),
				target: JSON.stringify({ host: { credentialId: 'missing-cred' } })
			}
		} as never);
		vi.mocked(resolveVncLaunchCredentials).mockRejectedValueOnce(
			new ServiceValidationError(['VNC credential is unavailable'])
		);

		await expect(createSessionLaunch({ hostId: 'host-1', protocol: 'vnc' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(connectionSessionService.start).not.toHaveBeenCalled();
	});

	it('creates RDP launches with resolved credentials and no reusable ticket exposure', async () => {
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'rdp-ticket',
			record: {
				hostId: 'host-1',
				protocol: 'rdp',
				expiresAt: new Date('2026-05-15T10:01:00.000Z'),
				target: JSON.stringify({ host: { credentialId: 'cred-1', username: 'desktop' } })
			}
		} as never);
		vi.mocked(resolveRdpLaunchCredentials).mockResolvedValueOnce({
			username: 'desktop',
			domain: 'DOMAIN',
			password: 'launch-secret',
			source: 'saved-password',
			unavailableReason: null
		} as never);
		ticketConsumerMocks.consume.mockResolvedValueOnce({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'rdp'
		});
		vi.mocked(connectionSessionService.start).mockResolvedValueOnce({
			id: 'rdp-connection'
		} as never);
		rdpGatewayMocks.bootstrap.mockResolvedValueOnce({
			gatewayUrl: 'wss://termix.test/rdp',
			token: 'gateway-token'
		});

		const launch = await createSessionLaunch({ hostId: 'host-1', protocol: 'rdp' });

		expect(resolveRdpLaunchCredentials).toHaveBeenCalledWith('user-1', {
			host: { credentialId: 'cred-1', username: 'desktop' }
		});
		expect(connectionSessionService.start).toHaveBeenCalledWith({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'rdp'
		});
		expect(launch).toMatchObject({
			hostId: 'host-1',
			protocol: 'rdp',
			ticket: null,
			websocketPath: null,
			connectionSessionId: 'rdp-connection',
			rdp: {
				gatewayUrl: 'wss://termix.test/rdp',
				token: 'gateway-token',
				connectionSessionId: 'rdp-connection'
			},
			rdpCredentials: {
				username: 'desktop',
				domain: 'DOMAIN',
				password: 'launch-secret',
				source: 'saved-password'
			}
		});
	});

	it('fails RDP launches when the ticket cannot be consumed', async () => {
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'rdp-ticket',
			record: {
				hostId: 'host-1',
				protocol: 'rdp',
				expiresAt: new Date('2026-05-15T10:01:00.000Z'),
				target: JSON.stringify({ host: { credentialId: null, username: 'desktop' } })
			}
		} as never);
		vi.mocked(resolveRdpLaunchCredentials).mockResolvedValueOnce({
			username: 'desktop',
			domain: null,
			password: null,
			source: 'none',
			unavailableReason: null
		} as never);
		ticketConsumerMocks.consume.mockResolvedValueOnce(null);

		await expect(createSessionLaunch({ hostId: 'host-1', protocol: 'rdp' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(connectionSessionService.start).not.toHaveBeenCalled();
		expect(rdpGatewayMocks.bootstrap).not.toHaveBeenCalled();
	});

	it('marks RDP launch failures with sanitized bootstrap error names', async () => {
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'rdp-ticket',
			record: {
				hostId: 'host-1',
				protocol: 'rdp',
				expiresAt: new Date('2026-05-15T10:01:00.000Z'),
				target: JSON.stringify({ host: { credentialId: null, username: 'desktop' } })
			}
		} as never);
		vi.mocked(resolveRdpLaunchCredentials).mockResolvedValueOnce({
			username: 'desktop',
			domain: null,
			password: null,
			source: 'none',
			unavailableReason: null
		} as never);
		ticketConsumerMocks.consume.mockResolvedValueOnce({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'rdp'
		});
		vi.mocked(connectionSessionService.start).mockResolvedValueOnce({
			id: 'rdp-connection'
		} as never);
		const error = new Error('gateway offline');
		error.name = 'Gateway Offline!';
		rdpGatewayMocks.bootstrap.mockRejectedValueOnce(error);
		vi.mocked(connectionSessionService.fail).mockResolvedValueOnce({
			id: 'rdp-connection'
		} as never);

		await expect(createSessionLaunch({ hostId: 'host-1', protocol: 'rdp' })).rejects.toBe(error);
		expect(connectionSessionService.fail).toHaveBeenCalledWith(
			'rdp-connection',
			'rdp_gateway_offline_'
		);
	});

	it('propagates RDP credential unavailable errors before consuming launch tickets', async () => {
		vi.mocked(sessionTicketService.create).mockResolvedValueOnce({
			ticket: 'rdp-ticket',
			record: {
				hostId: 'host-1',
				protocol: 'rdp',
				expiresAt: new Date('2026-05-15T10:01:00.000Z'),
				target: JSON.stringify({ host: { credentialId: 'missing-cred' } })
			}
		} as never);
		vi.mocked(resolveRdpLaunchCredentials).mockRejectedValueOnce(
			new ServiceValidationError(['RDP credential is unavailable'])
		);

		await expect(createSessionLaunch({ hostId: 'host-1', protocol: 'rdp' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(ticketConsumerMocks.consume).not.toHaveBeenCalled();
		expect(connectionSessionService.start).not.toHaveBeenCalled();
	});

	it('creates live SSH sessions and attach tickets with encoded websocket paths', async () => {
		vi.mocked(sshLiveSessionService.createOrReuse).mockResolvedValueOnce({
			session: liveSshSessionRecord({ id: 'live/session' })
		} as never);
		vi.mocked(hostService.get).mockResolvedValueOnce(
			hostRecord({ id: 'host-1', name: 'Shell host', hostname: 'shell.internal' }) as never
		);
		vi.mocked(sshLiveSessionService.createAttachTicket).mockResolvedValueOnce({
			ticket: 'attach/ticket',
			record: { expiresAt: new Date('2026-05-15T10:01:00.000Z') }
		} as never);

		const attach = await createLiveSshSession({
			hostId: 'host-1',
			title: 'Primary shell',
			cols: 120,
			rows: 34
		});

		expect(sshLiveSessionService.createOrReuse).toHaveBeenCalledWith('user-1', {
			hostId: 'host-1',
			title: 'Primary shell',
			terminalCols: 120,
			terminalRows: 34
		});
		expect(attach).toMatchObject({
			liveTicket: 'attach/ticket',
			liveWebsocketPath: '/ws/ssh/live/attach%2Fticket',
			expiresAt: '2026-05-15T10:01:00.000Z',
			session: {
				id: 'live/session',
				hostName: 'Shell host',
				hostname: 'shell.internal'
			}
		});
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('blocks live SSH creation when strict host-key trust has no pin', async () => {
		vi.mocked(getSshHostKeyTrustSummary).mockResolvedValueOnce(
			sshHostKeyTrustSummary({
				status: 'unknown',
				fingerprint: null,
				trust: null,
				trustOnFirstUse: false,
				message: 'SSH host key is not enrolled yet.'
			}) as never
		);

		await expect(createLiveSshSession({ hostId: 'host-1' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(sshLiveSessionService.createOrReuse).not.toHaveBeenCalled();
	});

	it('attaches live SSH sessions and rejects missing session ids before service calls', async () => {
		await expect(attachLiveSshSession({ cols: 80, rows: 24 })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(sshLiveSessionService.get).not.toHaveBeenCalled();
		expect(sshLiveSessionService.prepareAttach).not.toHaveBeenCalled();

		vi.mocked(sshLiveSessionService.get).mockResolvedValueOnce(
			liveSshSessionRecord({ id: 'live-1' }) as never
		);
		vi.mocked(hostService.get).mockResolvedValueOnce(hostRecord({ name: 'Shell host' }) as never);
		vi.mocked(sshLiveSessionService.prepareAttach).mockResolvedValueOnce(
			liveSshSessionRecord({ id: 'live-1' }) as never
		);
		vi.mocked(sshLiveSessionService.createAttachTicket).mockResolvedValueOnce({
			ticket: 'attach-ticket',
			record: { expiresAt: new Date('2026-05-15T10:01:00.000Z') }
		} as never);

		const attach = await attachLiveSshSession({ sessionId: 'live-1', cols: 100, rows: 40 });

		expect(sshLiveSessionService.get).toHaveBeenCalledWith('user-1', 'live-1');
		expect(hostService.get).toHaveBeenCalledWith('user-1', 'host-1');
		expect(sshLiveSessionService.prepareAttach).toHaveBeenCalledWith('user-1', 'live-1', {
			terminalCols: 100,
			terminalRows: 40
		});
		expect(attach.session).toMatchObject({ id: 'live-1', hostName: 'Shell host' });
	});

	it('does not prepare live SSH attach dimensions when host lookup fails', async () => {
		vi.mocked(sshLiveSessionService.get).mockResolvedValueOnce(
			liveSshSessionRecord({ id: 'live-1', hostId: 'deleted-host' }) as never
		);
		vi.mocked(hostService.get).mockRejectedValueOnce(new Error('host deleted'));

		await expect(
			attachLiveSshSession({ sessionId: 'live-1', cols: 100, rows: 40 })
		).rejects.toThrow('host deleted');
		expect(sshLiveSessionService.prepareAttach).not.toHaveBeenCalled();
	});

	it('does not refresh live SSH lists when rename fails', async () => {
		vi.mocked(sshLiveSessionService.rename).mockRejectedValueOnce(new Error('rename failed'));

		await expect(
			renameLiveSshSession({ sessionId: 'live-1', title: 'Renamed shell' })
		).rejects.toThrow('rename failed');
		expect(appServer.refresh).not.toHaveBeenCalled();
	});

	it('does not close the live SSH manager or refresh lists when service close fails', async () => {
		vi.mocked(sshLiveSessionService.close).mockRejectedValueOnce(new Error('close failed'));

		await expect(closeLiveSshSession('live-1')).rejects.toThrow('close failed');
		expect(liveSshManager.close).not.toHaveBeenCalled();
		expect(appServer.refresh).not.toHaveBeenCalled();
	});

	it('closes the live SSH manager after a successful service close', async () => {
		vi.mocked(sshLiveSessionService.close).mockResolvedValueOnce(undefined as never);

		await expect(closeLiveSshSession('live-1')).resolves.toBe(undefined);
		expect(liveSshManager.close).toHaveBeenCalledWith('live-1');
		expect(appServer.refresh).toHaveBeenCalledOnce();
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
				errorReason: 'connection refused',
				errorCode: 'ssh_failed',
				errorMessage: null
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
		vi.mocked(connectionSessionService.failForUserWithDetails).mockResolvedValueOnce({
			id: 'connection-1'
		} as never);

		await expect(
			recordConnectionSessionLifecycle({
				connectionSessionId: 'connection-1',
				event: 'failed',
				errorCode: 'SSH Auth Failed!',
				errorMessage: 'Auth failed',
				errorDetails: {
					phase: 'connect',
					password: 'must not persist',
					domainValue: 'DOMAIN'
				}
			})
		).resolves.toBe(undefined);
		expect(connectionSessionService.failForUserWithDetails).toHaveBeenCalledWith(
			'user-1',
			'connection-1',
			'ssh_auth_failed_',
			'Auth failed',
			{
				phase: 'connect',
				domainValue: 'DOMAIN'
			}
		);
	});

	it('uses sanitized fallback codes for failed connection lifecycle events without explicit errors', async () => {
		vi.mocked(connectionSessionService.failForUserWithDetails).mockResolvedValueOnce({
			id: 'connection-1'
		} as never);

		await expect(
			recordConnectionSessionLifecycle({
				connectionSessionId: 'connection-1',
				event: 'failed',
				errorCode: ''
			})
		).resolves.toBe(undefined);
		expect(connectionSessionService.failForUserWithDetails).toHaveBeenCalledWith(
			'user-1',
			'connection-1',
			'connection_failed',
			'Connection failed',
			{}
		);
	});

	it('records RDP lifecycle failures with the RDP prefix and truncated sanitized codes', async () => {
		vi.mocked(connectionSessionService.failForUserWithDetails).mockResolvedValueOnce({
			id: 'connection-1'
		} as never);
		const longCode = `RDP Gateway Offline ${'x'.repeat(160)}`;

		await expect(
			recordRdpSessionLifecycle({
				connectionSessionId: 'connection-1',
				event: 'failed',
				errorCode: longCode
			})
		).resolves.toBe(undefined);
		expect(connectionSessionService.failForUserWithDetails).toHaveBeenCalledWith(
			'user-1',
			'connection-1',
			expect.stringMatching(/^rdp_gateway_offline_x+$/),
			'Connection failed',
			{}
		);
		expect(
			vi.mocked(connectionSessionService.failForUserWithDetails).mock.calls[0][2]
		).toHaveLength(120);
	});

	it('rejects unsupported connection lifecycle events without mutating sessions', async () => {
		await expect(
			recordConnectionSessionLifecycle({
				connectionSessionId: 'connection-1',
				event: 'paused'
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(connectionSessionService.markActiveForUser).not.toHaveBeenCalled();
		expect(connectionSessionService.endForUser).not.toHaveBeenCalled();
		expect(connectionSessionService.failForUser).not.toHaveBeenCalled();
		expect(connectionSessionService.failForUserWithDetails).not.toHaveBeenCalled();
	});
});
