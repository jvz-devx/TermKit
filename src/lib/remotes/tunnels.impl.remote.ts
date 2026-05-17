import { command, query } from '$app/server';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { sshTunnelService } from '$lib/server/services/ssh-tunnels';
import {
	requireRemoteUser,
	toSshTunnelProfileSummary,
	toSshTunnelSessionSummary,
	type SshTunnelProfileMutationInput,
	type SshTunnelProfileSummary,
	type SshTunnelSessionSummary,
	type StartSshTunnelInput
} from './termix-core.shared';

export type {
	HostSummary,
	SshTunnelProfileMutationInput,
	SshTunnelProfileSummary,
	SshTunnelSessionSummary,
	StartSshTunnelInput
} from './termix-core.shared';

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
