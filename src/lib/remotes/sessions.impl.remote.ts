import { command, query } from '$app/server';
import { hostService } from '$lib/server/services/hosts';
import {
	parseSessionTicketTargetSnapshot,
	sessionTicketService
} from '$lib/server/services/session-tickets';
import { ServiceValidationError } from '$lib/server/services/errors';
import { RdpGatewayBootstrapper, type RdpGatewayBootstrap } from '$lib/server/rdp/gateway';
import { SessionTicketConsumer } from '$lib/server/ws/ticket-consumer';
import { resolveVncLaunchCredentials } from '$lib/server/protocols/vnc';
import { resolveRdpLaunchCredentials } from '$lib/server/protocols/rdp-credentials';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { settingsService } from '$lib/server/services/settings';
import { sshLiveSessionService } from '$lib/server/services/ssh-live-sessions';
import { liveSshManager } from '$lib/server/ssh-live/manager';
import {
	assertSshHostKeyLaunchAllowed,
	createLiveSshAttach,
	rdpLaunchErrorCode,
	requireRemoteUser,
	sanitizeConnectionErrorCode,
	toConnectionHistorySummary,
	toLiveSshSessionSummary,
	type LiveSshAttach,
	type LiveSshSessionSummary,
	type SessionLaunch
} from './termix-core.shared';

export type {
	ConnectionHistorySummary,
	HostSummary,
	LaunchProtocol,
	LiveSshAttach,
	LiveSshSessionSummary,
	RdpLaunchCredentials,
	SessionLaunch
} from './termix-core.shared';

export const listConnectionHistory = query(async () => {
	const userId = requireRemoteUser();
	const rows = await connectionSessionService.listHistory(userId);
	return rows.map(toConnectionHistorySummary);
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
