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
import { liveSshManager } from '$lib/server/ssh-live/manager';
import type {
	CredentialKind,
	HostProtocol,
	HostRecord,
	SshLiveSessionRecord
} from '$lib/server/services/types';

export type { RdpLaunchCredentials };

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
	terminalCols: number;
	terminalRows: number;
	updatedAt: string;
};

export type LiveSshAttach = {
	session: LiveSshSessionSummary;
	liveTicket: string;
	liveWebsocketPath: string | null;
	fallbackTicket: string;
	fallbackWebsocketPath: string;
	expiresAt: string;
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

	return hosts
		.map(
			(host): HostSummary => ({
				id: host.id,
				name: host.name,
				protocol: host.protocol,
				hostname: host.hostname,
				port: host.port,
				username: host.username,
				credentialId: host.credentialId,
				credentialName: host.credentialId ? (credentialNames.get(host.credentialId) ?? null) : null,
				folder: host.folder,
				tags: host.tags,
				notes: host.notes,
				createdAt: host.createdAt.toISOString(),
				updatedAt: host.updatedAt.toISOString()
			})
		)
		.sort((left, right) => left.name.localeCompare(right.name));
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
		.map((session): LiveSshSessionSummary | null => {
			const host = hostsById.get(session.hostId);
			if (!host) return null;
			return toLiveSshSessionSummary(session, host);
		})
		.filter((session): session is LiveSshSessionSummary => Boolean(session));
});

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
		id: host.id,
		name: host.name,
		protocol: host.protocol,
		hostname: host.hostname,
		port: host.port,
		username: host.username,
		credentialId: host.credentialId,
		credentialName: null,
		folder: host.folder,
		tags: host.tags,
		notes: host.notes,
		createdAt: host.createdAt.toISOString(),
		updatedAt: host.updatedAt.toISOString()
	};
});

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

export const createSessionLaunch = command<{ hostId?: unknown; protocol?: unknown }, SessionLaunch>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const hostId = typeof input.hostId === 'string' ? input.hostId : '';
		const protocol = input.protocol;

		if (!hostId) throw new ServiceValidationError(['hostId is required']);
		if (protocol === 'sftp') {
			await hostService.get(userId, hostId);
			return {
				hostId,
				protocol,
				ticket: null,
				websocketPath: null,
				expiresAt: null,
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

	const session = await sshLiveSessionService.get(userId, sessionId);
	const host = await hostService.get(userId, session.hostId);
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

export const recordRdpSessionLifecycle = command<
	{ connectionSessionId?: unknown; event?: unknown; errorCode?: unknown },
	void
>('unchecked', async (input) => {
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
							sanitizeRdpErrorCode(input.errorCode)
						)
					: null;

	if (!updated) {
		throw new ServiceValidationError(['connectionSessionId is invalid or event is unsupported']);
	}
});

function requireRemoteUser(): string {
	const userId = getRequestEvent().locals.user?.id;
	if (!userId) throw new ServiceUnauthorizedError();
	return userId;
}

function rdpLaunchErrorCode(error: unknown): string {
	if (error instanceof Error && error.name) return sanitizeRdpErrorCode(`rdp_${error.name}`);
	return 'rdp_launch_failed';
}

function sanitizeRdpErrorCode(value: unknown): string {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'rdp_client_failed';
	const sanitized = raw.toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
	return sanitized.slice(0, 120) || 'rdp_client_failed';
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
	const fallback = await sessionTicketService.create(userId, {
		hostId: session.hostId,
		protocol: 'ssh',
		ttlMs
	});

	return {
		session,
		liveTicket: liveTicket.ticket,
		liveWebsocketPath: `/ws/ssh/live/${encodeURIComponent(liveTicket.ticket)}`,
		fallbackTicket: fallback.ticket,
		fallbackWebsocketPath: `/ws/ssh/${encodeURIComponent(fallback.ticket)}`,
		expiresAt: liveTicket.record.expiresAt.toISOString()
	};
}

function toLiveSshSessionSummary(
	session: SshLiveSessionRecord,
	host: HostRecord
): LiveSshSessionSummary {
	return {
		id: session.id,
		hostId: session.hostId,
		hostName: host.name,
		hostname: host.hostname,
		username: host.username,
		title: session.title,
		status: session.status,
		startedAt: session.startedAt.toISOString(),
		lastAttachedAt: session.lastAttachedAt?.toISOString() ?? null,
		detachedAt: session.detachedAt?.toISOString() ?? null,
		expiresAt: session.expiresAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		terminalCols: session.terminalCols,
		terminalRows: session.terminalRows,
		updatedAt: session.updatedAt.toISOString()
	};
}
