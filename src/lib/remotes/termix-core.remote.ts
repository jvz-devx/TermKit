import { randomUUID } from 'node:crypto';
import { command, getRequestEvent, query } from '$app/server';
import { hostService } from '$lib/server/services/hosts';
import { credentialService } from '$lib/server/services/credentials';
import {
	parseSessionTicketTargetSnapshot,
	sessionTicketService
} from '$lib/server/services/session-tickets';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { RdpGatewayBootstrapper, type RdpGatewayBootstrap } from '$lib/server/rdp/gateway';
import { SessionTicketConsumer } from '$lib/server/ws/ticket-consumer';
import { resolveVncLaunchCredentials, type VncLaunchCredentials } from '$lib/server/protocols/vnc';
import {
	resolveRdpLaunchCredentials,
	type RdpLaunchCredentials
} from '$lib/server/protocols/rdp-credentials';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { settingsService } from '$lib/server/services/settings';
import { sshLiveSessionService } from '$lib/server/services/ssh-live-sessions';
import { termixRepository } from '$lib/server/services/repository';
import {
	publicSshTunnelPath,
	sshTunnelService,
	type SshTunnelProfileRecord,
	type SshTunnelSessionRecord
} from '$lib/server/services/ssh-tunnels';
import { liveSshManager } from '$lib/server/ssh-live/manager';
import {
	enrollSshHostKey as enrollSshHostKeyForUser,
	getSshHostKeyTrustSummary,
	type SshHostKeyTrustSummary
} from '$lib/server/protocols/ssh-host-key-enrollment';
import type {
	ConnectionHistoryRecord,
	ConnectionProtocol,
	ConnectionSessionStatus,
	CredentialKind,
	HostProtocol,
	HostRecord,
	SshLiveSessionRecord
} from '$lib/server/services/types';
import {
	normalizeHostMetadata,
	type FtpsHostMetadata,
	type SshJumpHostMetadata,
	type TerminalPreferences
} from '$lib/termix/host-metadata';
import { isSessionLayoutKind } from '$lib/components/termix/session/layout/workspace-layout';

export type { RdpLaunchCredentials };
export type { SshHostKeyTrustSummary };

export type HostSummary = {
	id: string;
	name: string;
	protocol: HostProtocol;
	hostname: string;
	port: number;
	username: string | null;
	credentialId: string | null;
	credentialName: string | null;
	folder: string | null;
	tags: string[];
	notes: string | null;
	metadata: Record<string, unknown>;
	terminalPreferences: TerminalPreferences;
	sshJumpHost: SshJumpHostMetadata;
	ftps: FtpsHostMetadata;
	hostKeyTrust: SshHostKeyTrustSummary | null;
	createdAt: string;
	updatedAt: string;
};

export type CredentialSummary = {
	id: string;
	name: string;
	kind: CredentialKind;
	username: string | null;
	usedBy: number;
	createdAt: string;
	updatedAt: string;
};

export type HostMutationInput = {
	id?: string;
	name?: unknown;
	protocol?: unknown;
	hostname?: unknown;
	port?: unknown;
	username?: unknown;
	credentialId?: unknown;
	folder?: unknown;
	tags?: unknown;
	notes?: unknown;
	metadata?: unknown;
};

export type CredentialMutationInput = {
	id?: string;
	name?: unknown;
	kind?: unknown;
	username?: unknown;
	secret?: unknown;
};

export type LaunchProtocol = HostProtocol | 'sftp';

export type SessionLaunch = {
	hostId: string;
	protocol: LaunchProtocol;
	ticket: string | null;
	websocketPath: string | null;
	expiresAt: string | null;
	connectionSessionId: string | null;
	rdp: RdpGatewayBootstrap | null;
	rdpCredentials: RdpLaunchCredentials | null;
	vncCredentials: VncLaunchCredentials | null;
};

export type LiveSshSessionSummary = {
	id: string;
	hostId: string;
	hostName: string;
	hostname: string;
	username: string | null;
	title: string;
	status: 'starting' | 'attached' | 'detached' | 'ended' | 'failed' | 'stale';
	startedAt: string;
	lastAttachedAt: string | null;
	detachedAt: string | null;
	expiresAt: string | null;
	endedAt: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	terminalCols: number;
	terminalRows: number;
	updatedAt: string;
};

export type LiveSshAttach = {
	session: LiveSshSessionSummary;
	liveTicket: string;
	liveWebsocketPath: string;
	expiresAt: string;
};

export type SshTunnelProfileSummary = {
	id: string;
	hostId: string;
	name: string;
	targetHost: string;
	targetPort: number;
	createdAt: string;
	updatedAt: string;
};

export type SshTunnelSessionSummary = {
	id: string;
	profileId: string | null;
	hostId: string;
	targetHost: string;
	targetPort: number;
	status: 'active' | 'idle' | 'ended' | 'failed';
	failureCode: string | null;
	publicPath: string;
	websocketPath: string;
	startedAt: string;
	lastUsedAt: string | null;
	endedAt: string | null;
	updatedAt: string;
};

export type SshTunnelProfileMutationInput = {
	id?: unknown;
	hostId?: unknown;
	name?: unknown;
	targetHost?: unknown;
	targetPort?: unknown;
};

export type StartSshTunnelInput = {
	profileId?: unknown;
	hostId?: unknown;
	name?: unknown;
	targetHost?: unknown;
	targetPort?: unknown;
};

export type SessionWorkspaceLayoutMetadata = {
	layout: string;
	panes: Record<string, unknown>[];
	updatedAt?: string;
};

export type ConnectionHistorySummary = {
	id: string;
	userId: string;
	user: string;
	workspaceId: string | null;
	workspace: string;
	hostId: string | null;
	host: string;
	hostname: string;
	hostUser: string | null;
	protocol: ConnectionProtocol;
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	status: ConnectionSessionStatus;
	errorReason: string | null;
	errorCode: string | null;
	errorMessage: string | null;
};

export const listHosts = query(async () => {
	const userId = requireRemoteUser();
	const [hosts, credentials] = await Promise.all([
		hostService.list(userId),
		credentialService.list(userId)
	]);
	const credentialNames = new Map(
		credentials.map((credential) => [credential.id, credential.name])
	);

	const summaries = await Promise.all(
		hosts.map(async (host): Promise<HostSummary> => {
			const hostKeyTrust =
				host.protocol === 'ssh' ? await safeSshHostKeyTrustSummary(userId, host.id) : null;
			return toHostSummary(host, credentialNames.get(host.credentialId ?? ''), hostKeyTrust);
		})
	);

	return summaries.sort((left, right) => left.name.localeCompare(right.name));
});

export const listConnectionHistory = query(async () => {
	const userId = requireRemoteUser();
	const rows = await connectionSessionService.listHistory(userId);
	return rows.map(toConnectionHistorySummary);
});

export const listCredentials = query(async () => {
	const userId = requireRemoteUser();
	const [credentials, hosts] = await Promise.all([
		credentialService.list(userId),
		hostService.list(userId)
	]);

	return credentials
		.map(
			(credential): CredentialSummary => ({
				id: credential.id,
				name: credential.name,
				kind: credential.kind,
				username: credential.username,
				usedBy: hosts.filter((host) => host.credentialId === credential.id).length,
				createdAt: credential.createdAt.toISOString(),
				updatedAt: credential.updatedAt.toISOString()
			})
		)
		.sort((left, right) => left.name.localeCompare(right.name));
});

export const listLiveSshSessions = query(async () => {
	const userId = requireRemoteUser();
	const [sessions, hosts] = await Promise.all([
		sshLiveSessionService.listVisible(userId),
		hostService.list(userId)
	]);
	const hostsById = new Map(hosts.map((host) => [host.id, host]));

	return sessions
		.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
		.map((session): LiveSshSessionSummary => {
			const host = hostsById.get(session.hostId);
			return toLiveSshSessionSummary(session, host);
		});
});

export const listSshTunnelProfiles = query(async () => {
	const userId = requireRemoteUser();
	const profiles = await sshTunnelService.listProfiles(userId);
	return profiles.map(toSshTunnelProfileSummary);
});

export const listSshTunnelSessions = query(async () => {
	const userId = requireRemoteUser();
	const sessions = await sshTunnelService.listSessions(userId);
	return sessions.map(toSshTunnelSessionSummary);
});

export const getSessionWorkspaceLayout = query(
	async (): Promise<SessionWorkspaceLayoutMetadata | null> => {
		const userId = requireRemoteUser();
		const [layout] = await termixRepository.listWorkspaceLayouts(userId);
		if (!layout) return null;

		return {
			layout: layout.layoutKind,
			panes: layout.panes,
			updatedAt: layout.updatedAt.toISOString()
		};
	}
);

export const saveHost = command<HostMutationInput, HostSummary>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const tags =
		typeof input.tags === 'string'
			? input.tags
					.split(',')
					.map((tag) => tag.trim())
					.filter(Boolean)
			: input.tags;
	const normalized = {
		...input,
		tags,
		credentialId: input.credentialId === 'none' ? null : input.credentialId
	};
	const host =
		typeof input.id === 'string' && input.id
			? await hostService.update(userId, input.id, normalized)
			: await hostService.create(userId, normalized);

	void listHosts().refresh();
	void listCredentials().refresh();

	return {
		...toHostSummary(host, null),
		credentialName: null
	};
});

export const inspectSshHostKeyTrust = command<unknown, SshHostKeyTrustSummary>(
	'unchecked',
	async (hostId) => {
		const userId = requireRemoteUser();
		if (typeof hostId !== 'string' || !hostId) {
			throw new ServiceValidationError(['hostId is required']);
		}
		return getSshHostKeyTrustSummary(userId, hostId);
	}
);

export const enrollSshHostKey = command<unknown, SshHostKeyTrustSummary>(
	'unchecked',
	async (hostId) => {
		const userId = requireRemoteUser();
		if (typeof hostId !== 'string' || !hostId) {
			throw new ServiceValidationError(['hostId is required']);
		}
		const trust = await enrollSshHostKeyForUser(userId, hostId);
		void listHosts().refresh();
		return trust;
	}
);

export const deleteHost = command<string, void>('unchecked', async (id) => {
	const userId = requireRemoteUser();
	if (typeof id !== 'string' || !id) throw new ServiceValidationError(['id is required']);
	await hostService.delete(userId, id);
	void listHosts().refresh();
	void listCredentials().refresh();
});

export const saveCredential = command<CredentialMutationInput, CredentialSummary>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const credential =
			typeof input.id === 'string' && input.id
				? await credentialService.update(userId, input.id, input)
				: await credentialService.create(userId, input);

		void listCredentials().refresh();

		return {
			id: credential.id,
			name: credential.name,
			kind: credential.kind,
			username: credential.username,
			usedBy: 0,
			createdAt: credential.createdAt.toISOString(),
			updatedAt: credential.updatedAt.toISOString()
		};
	}
);

export const deleteCredential = command<string, void>('unchecked', async (id) => {
	const userId = requireRemoteUser();
	if (typeof id !== 'string' || !id) throw new ServiceValidationError(['id is required']);
	await credentialService.delete(userId, id);
	void listCredentials().refresh();
	void listHosts().refresh();
});

export const saveSessionWorkspaceLayout = command<
	{ metadata?: unknown },
	SessionWorkspaceLayoutMetadata
>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const metadata = validateSessionWorkspaceLayoutMetadata(input.metadata);
	const [existing] = await termixRepository.listWorkspaceLayouts(userId);
	const now = new Date();
	const saved = existing
		? await termixRepository.updateWorkspaceLayout(userId, existing.id, {
				layoutKind: metadata.layout,
				panes: metadata.panes,
				updatedAt: now
			})
		: await termixRepository.createWorkspaceLayout({
				id: randomUUID(),
				userId,
				workspaceId: null,
				layoutKind: metadata.layout,
				panes: metadata.panes,
				createdAt: now,
				updatedAt: now
			});

	if (!saved) throw new ServiceValidationError(['Could not save workspace layout']);
	void getSessionWorkspaceLayout().refresh();

	return {
		layout: saved.layoutKind,
		panes: saved.panes,
		updatedAt: saved.updatedAt.toISOString()
	};
});

export const createSessionLaunch = command<{ hostId?: unknown; protocol?: unknown }, SessionLaunch>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const hostId = typeof input.hostId === 'string' ? input.hostId : '';
		const protocol = input.protocol;

		if (!hostId) throw new ServiceValidationError(['hostId is required']);
		if (protocol === 'sftp') {
			const host = await hostService.get(userId, hostId);
			if (host.protocol !== 'ssh') {
				throw new ServiceValidationError(['SFTP sessions require an SSH host']);
			}
			const connectionSession = await connectionSessionService.start({
				userId,
				hostId,
				protocol: 'ssh'
			});
			const activeSession = await connectionSessionService.markActive(connectionSession.id);
			if (!activeSession) throw new ServiceValidationError(['Could not start SFTP session']);

			return {
				hostId,
				protocol,
				ticket: null,
				websocketPath: null,
				expiresAt: null,
				connectionSessionId: connectionSession.id,
				rdp: null,
				rdpCredentials: null,
				vncCredentials: null
			};
		}
		if (protocol === 'ftp' || protocol === 'ftps') {
			const host = await hostService.get(userId, hostId);
			if (host.protocol !== protocol) {
				throw new ServiceValidationError([
					`${String(protocol).toUpperCase()} sessions require a ${String(protocol).toUpperCase()} host`
				]);
			}
			const connectionSession = await connectionSessionService.start({
				userId,
				hostId,
				protocol
			});
			const activeSession = await connectionSessionService.markActive(connectionSession.id);
			if (!activeSession)
				throw new ServiceValidationError([
					`Could not start ${String(protocol).toUpperCase()} session`
				]);

			return {
				hostId,
				protocol,
				ticket: null,
				websocketPath: null,
				expiresAt: null,
				connectionSessionId: connectionSession.id,
				rdp: null,
				rdpCredentials: null,
				vncCredentials: null
			};
		}

		const settings = await settingsService.getBasicAppSettings();
		const created = await sessionTicketService.create(userId, {
			hostId,
			protocol,
			ttlMs: settings.ticketTtlSeconds * 1000
		});
		const launchProtocol = created.record.protocol;
		const ticket = created.ticket;

		if (launchProtocol === 'rdp') {
			const bootstrapper = new RdpGatewayBootstrapper();
			const rdpCredentials = await resolveRdpLaunchCredentials(
				userId,
				parseSessionTicketTargetSnapshot(created.record)
			);
			const consumed = await new SessionTicketConsumer().consume(ticket, 'rdp');
			if (!consumed) throw new ServiceValidationError(['Could not authorize RDP launch']);
			const connectionSession = await connectionSessionService.start({
				userId: consumed.userId,
				hostId: consumed.hostId,
				protocol: 'rdp'
			});
			let rdp: RdpGatewayBootstrap;

			try {
				rdp = {
					...(await bootstrapper.bootstrap(consumed)),
					connectionSessionId: connectionSession.id
				};
			} catch (error) {
				await connectionSessionService
					.fail(connectionSession.id, rdpLaunchErrorCode(error))
					.catch(() => null);
				throw error;
			}

			return {
				hostId,
				protocol: launchProtocol,
				ticket: null,
				websocketPath: null,
				expiresAt: created.record.expiresAt.toISOString(),
				connectionSessionId: connectionSession.id,
				rdp,
				rdpCredentials,
				vncCredentials: null
			};
		}

		const vncCredentials =
			launchProtocol === 'vnc'
				? await resolveVncLaunchCredentials(
						userId,
						parseSessionTicketTargetSnapshot(created.record)
					)
				: null;

		return {
			hostId,
			protocol: launchProtocol,
			ticket,
			websocketPath: `/ws/${launchProtocol}/${encodeURIComponent(ticket)}`,
			expiresAt: created.record.expiresAt.toISOString(),
			connectionSessionId: null,
			rdp: null,
			rdpCredentials: null,
			vncCredentials
		};
	}
);

export const createLiveSshSession = command<
	{ hostId?: unknown; title?: unknown; cols?: unknown; rows?: unknown },
	LiveSshAttach
>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const hostId = typeof input.hostId === 'string' ? input.hostId : '';
	if (!hostId) throw new ServiceValidationError(['hostId is required']);
	await assertSshHostKeyLaunchAllowed(userId, hostId);

	const { session } = await sshLiveSessionService.createOrReuse(userId, {
		hostId,
		title: input.title,
		terminalCols: input.cols,
		terminalRows: input.rows
	});
	const host = await hostService.get(userId, session.hostId);
	void listLiveSshSessions().refresh();

	return createLiveSshAttach(userId, toLiveSshSessionSummary(session, host));
});

export const attachLiveSshSession = command<
	{ sessionId?: unknown; cols?: unknown; rows?: unknown },
	LiveSshAttach
>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
	if (!sessionId) throw new ServiceValidationError(['sessionId is required']);

	const existingSession = await sshLiveSessionService.get(userId, sessionId);
	await assertSshHostKeyLaunchAllowed(userId, existingSession.hostId);
	const host = await hostService.get(userId, existingSession.hostId);
	const session = await sshLiveSessionService.prepareAttach(userId, sessionId, {
		terminalCols: input.cols,
		terminalRows: input.rows
	});
	void listLiveSshSessions().refresh();

	return createLiveSshAttach(userId, toLiveSshSessionSummary(session, host));
});

export const renameLiveSshSession = command<{ sessionId?: unknown; title?: unknown }, void>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
		if (!sessionId) throw new ServiceValidationError(['sessionId is required']);

		await sshLiveSessionService.rename(userId, sessionId, input.title);
		void listLiveSshSessions().refresh();
	}
);

export const closeLiveSshSession = command<string, void>('unchecked', async (sessionId) => {
	const userId = requireRemoteUser();
	if (typeof sessionId !== 'string' || !sessionId) {
		throw new ServiceValidationError(['sessionId is required']);
	}

	await sshLiveSessionService.close(userId, sessionId);
	liveSshManager.close(sessionId);
	void listLiveSshSessions().refresh();
});

export const saveSshTunnelProfile = command<SshTunnelProfileMutationInput, SshTunnelProfileSummary>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const profile = await sshTunnelService.saveProfile(userId, input);
		void listSshTunnelProfiles().refresh();
		return toSshTunnelProfileSummary(profile);
	}
);

export const deleteSshTunnelProfile = command<string, void>('unchecked', async (profileId) => {
	const userId = requireRemoteUser();
	await sshTunnelService.deleteProfile(userId, profileId);
	void listSshTunnelProfiles().refresh();
});

export const startSshTunnelSession = command<StartSshTunnelInput, SshTunnelSessionSummary>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const session = await sshTunnelService.startSession(userId, input);
		try {
			const connectionSession = await connectionSessionService.start({
				id: session.id,
				userId,
				hostId: session.hostId,
				protocol: 'ssh_tunnel'
			});
			await connectionSessionService.markActive(connectionSession.id);
		} catch (error) {
			await sshTunnelService
				.failSession(userId, session.id, 'tunnel_proxy_failed')
				.catch(() => null);
			throw error;
		}
		void listSshTunnelSessions().refresh();
		return toSshTunnelSessionSummary(session);
	}
);

export const inspectSshTunnelSession = command<string, SshTunnelSessionSummary>(
	'unchecked',
	async (sessionId) => {
		const userId = requireRemoteUser();
		const session = await sshTunnelService.inspectSession(userId, sessionId);
		void listSshTunnelSessions().refresh();
		return toSshTunnelSessionSummary(session);
	}
);

export const terminateSshTunnelSession = command<string, SshTunnelSessionSummary>(
	'unchecked',
	async (sessionId) => {
		const userId = requireRemoteUser();
		const session = await sshTunnelService.terminateSession(userId, sessionId);
		await connectionSessionService.endForUser(userId, session.id).catch(() => null);
		void listSshTunnelSessions().refresh();
		return toSshTunnelSessionSummary(session);
	}
);

type ConnectionSessionLifecycleInput = {
	connectionSessionId?: unknown;
	event?: unknown;
	errorCode?: unknown;
};

async function recordConnectionSessionLifecycleEvent(
	input: ConnectionSessionLifecycleInput,
	errorCodePrefix = 'connection'
): Promise<void> {
	const userId = requireRemoteUser();
	const connectionSessionId =
		typeof input.connectionSessionId === 'string' ? input.connectionSessionId : '';
	const event = typeof input.event === 'string' ? input.event : '';

	if (!connectionSessionId) throw new ServiceValidationError(['connectionSessionId is required']);

	const updated =
		event === 'connected'
			? await connectionSessionService.markActiveForUser(userId, connectionSessionId)
			: event === 'ended'
				? await connectionSessionService.endForUser(userId, connectionSessionId)
				: event === 'failed'
					? await connectionSessionService.failForUser(
							userId,
							connectionSessionId,
							sanitizeConnectionErrorCode(input.errorCode, errorCodePrefix)
						)
					: null;

	if (!updated) {
		throw new ServiceValidationError(['connectionSessionId is invalid or event is unsupported']);
	}
}

export const recordConnectionSessionLifecycle = command<ConnectionSessionLifecycleInput, void>(
	'unchecked',
	(input) => recordConnectionSessionLifecycleEvent(input)
);

export const recordRdpSessionLifecycle = command<
	{ connectionSessionId?: unknown; event?: unknown; errorCode?: unknown },
	void
>('unchecked', (input) => recordConnectionSessionLifecycleEvent(input, 'rdp'));

function requireRemoteUser(): string {
	const userId = getRequestEvent().locals.user?.id;
	if (!userId) throw new ServiceUnauthorizedError();
	return userId;
}

function toConnectionHistorySummary(record: ConnectionHistoryRecord): ConnectionHistorySummary {
	return {
		id: record.id,
		userId: record.userId,
		user: record.username ?? 'Unknown user',
		workspaceId: record.workspaceId,
		workspace: record.workspaceName ?? 'Personal workspace',
		hostId: record.hostId,
		host: record.hostName ?? 'Deleted host',
		hostname: record.hostname ?? 'Unknown host',
		hostUser: record.hostUsername,
		protocol: record.protocol,
		startedAt: record.startedAt.toISOString(),
		endedAt: record.endedAt?.toISOString() ?? null,
		durationMs: record.durationMs,
		status: record.status,
		errorReason: record.errorReason,
		errorCode: record.errorCode,
		errorMessage: record.errorMessage
	};
}

async function safeSshHostKeyTrustSummary(
	userId: string,
	hostId: string
): Promise<SshHostKeyTrustSummary | null> {
	try {
		return await getSshHostKeyTrustSummary(userId, hostId);
	} catch {
		return null;
	}
}

async function assertSshHostKeyLaunchAllowed(userId: string, hostId: string): Promise<void> {
	const trust = await getSshHostKeyTrustSummary(userId, hostId);
	if (trust.status === 'unknown' && !trust.trustOnFirstUse) {
		throw new ServiceValidationError([
			'SSH host key is not enrolled. Enroll the host key before opening this SSH session.'
		]);
	}
}

function toHostSummary(
	host: HostRecord,
	credentialName: string | null | undefined,
	hostKeyTrust: SshHostKeyTrustSummary | null = null
): HostSummary {
	const metadata = normalizeHostMetadata(host.metadata);
	return {
		id: host.id,
		name: host.name,
		protocol: host.protocol,
		hostname: host.hostname,
		port: host.port,
		username: host.username,
		credentialId: host.credentialId,
		credentialName: host.credentialId ? (credentialName ?? null) : null,
		folder: host.folder,
		tags: host.tags,
		notes: host.notes,
		metadata,
		terminalPreferences: metadata.terminalPreferences,
		sshJumpHost: metadata.sshJumpHost,
		ftps: metadata.ftps,
		hostKeyTrust,
		createdAt: host.createdAt.toISOString(),
		updatedAt: host.updatedAt.toISOString()
	};
}

function validateSessionWorkspaceLayoutMetadata(value: unknown): SessionWorkspaceLayoutMetadata {
	if (!isRecord(value)) throw new ServiceValidationError(['metadata is required']);
	const layout = typeof value.layout === 'string' ? value.layout : '';
	const panes = Array.isArray(value.panes) ? value.panes.filter(isRecord) : [];
	if (!isSessionLayoutKind(layout)) {
		throw new ServiceValidationError(['layout is invalid']);
	}
	if (panes.length < 1 || panes.length > 4) {
		throw new ServiceValidationError(['panes must contain between 1 and 4 entries']);
	}

	return {
		layout,
		panes,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rdpLaunchErrorCode(error: unknown): string {
	if (error instanceof Error && error.name) return sanitizeRdpErrorCode(`rdp_${error.name}`);
	return 'rdp_launch_failed';
}

function sanitizeRdpErrorCode(value: unknown): string {
	return sanitizeConnectionErrorCode(value, 'rdp_client');
}

function sanitizeConnectionErrorCode(value: unknown, fallbackPrefix: string): string {
	const fallback = `${fallbackPrefix}_failed`;
	const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
	const sanitized = raw.toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
	return sanitized.slice(0, 120) || fallback;
}

async function createLiveSshAttach(
	userId: string,
	session: LiveSshSessionSummary
): Promise<LiveSshAttach> {
	const settings = await settingsService.getBasicAppSettings();
	const ttlMs = settings.ticketTtlSeconds * 1000;
	const liveTicket = await sshLiveSessionService.createAttachTicket(
		userId,
		session.id,
		new Date(),
		ttlMs
	);

	return {
		session,
		liveTicket: liveTicket.ticket,
		liveWebsocketPath: `/ws/ssh/live/${encodeURIComponent(liveTicket.ticket)}`,
		expiresAt: liveTicket.record.expiresAt.toISOString()
	};
}

function toLiveSshSessionSummary(
	session: SshLiveSessionRecord,
	host: HostRecord | undefined
): LiveSshSessionSummary {
	return {
		id: session.id,
		hostId: session.hostId,
		hostName: host?.name ?? 'Deleted host',
		hostname: host?.hostname ?? 'Unknown host',
		username: host?.username ?? null,
		title: session.title,
		status: session.status,
		startedAt: session.startedAt.toISOString(),
		lastAttachedAt: session.lastAttachedAt?.toISOString() ?? null,
		detachedAt: session.detachedAt?.toISOString() ?? null,
		expiresAt: session.expiresAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		errorCode: session.errorCode,
		errorMessage: session.errorMessage,
		terminalCols: session.terminalCols,
		terminalRows: session.terminalRows,
		updatedAt: session.updatedAt.toISOString()
	};
}

function toSshTunnelProfileSummary(profile: SshTunnelProfileRecord): SshTunnelProfileSummary {
	return {
		id: profile.id,
		hostId: profile.hostId,
		name: profile.name,
		targetHost: profile.targetHost,
		targetPort: profile.targetPort,
		createdAt: profile.createdAt.toISOString(),
		updatedAt: profile.updatedAt.toISOString()
	};
}

function toSshTunnelSessionSummary(session: SshTunnelSessionRecord): SshTunnelSessionSummary {
	return {
		id: session.id,
		profileId: session.profileId,
		hostId: session.hostId,
		targetHost: session.targetHost,
		targetPort: session.targetPort,
		status: session.status,
		failureCode: session.failureCode,
		publicPath: publicSshTunnelPath(session.id),
		websocketPath: `/ws/tunnel/${encodeURIComponent(session.id)}`,
		startedAt: session.startedAt.toISOString(),
		lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		updatedAt: session.updatedAt.toISOString()
	};
}
