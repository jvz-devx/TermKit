import { termixRepository } from './repository';
import type {
	SshTunnelFailureCode,
	SshTunnelProfileRecord,
	SshTunnelRepository,
	SshTunnelSessionRecord,
	SshTunnelSessionStatus
} from './ssh-tunnels';
import type {
	SshTunnelProfileRecord as StoredSshTunnelProfileRecord,
	SshTunnelSessionRecord as StoredSshTunnelSessionRecord,
	TermixServicesRepository
} from './types';

export class InMemorySshTunnelRepository implements SshTunnelRepository {
	private readonly profiles = new Map<string, SshTunnelProfileRecord>();
	private readonly sessions = new Map<string, SshTunnelSessionRecord>();

	async listSshTunnelProfiles(userId: string): Promise<SshTunnelProfileRecord[]> {
		return [...this.profiles.values()].filter((profile) => profile.userId === userId);
	}

	async getSshTunnelProfile(userId: string, id: string): Promise<SshTunnelProfileRecord | null> {
		const profile = this.profiles.get(id);
		return profile?.userId === userId ? profile : null;
	}

	async createSshTunnelProfile(profile: SshTunnelProfileRecord): Promise<SshTunnelProfileRecord> {
		this.profiles.set(profile.id, profile);
		return profile;
	}

	async updateSshTunnelProfile(
		userId: string,
		id: string,
		patch: Partial<SshTunnelProfileRecord>
	): Promise<SshTunnelProfileRecord | null> {
		const profile = await this.getSshTunnelProfile(userId, id);
		if (!profile) return null;
		const updated = { ...profile, ...patch, id, userId };
		this.profiles.set(id, updated);
		return updated;
	}

	async deleteSshTunnelProfile(userId: string, id: string): Promise<boolean> {
		const profile = await this.getSshTunnelProfile(userId, id);
		if (!profile) return false;
		return this.profiles.delete(id);
	}

	async listSshTunnelSessions(userId: string): Promise<SshTunnelSessionRecord[]> {
		return [...this.sessions.values()].filter((session) => session.userId === userId);
	}

	async getSshTunnelSession(userId: string, id: string): Promise<SshTunnelSessionRecord | null> {
		const session = this.sessions.get(id);
		return session?.userId === userId ? session : null;
	}

	async createSshTunnelSession(session: SshTunnelSessionRecord): Promise<SshTunnelSessionRecord> {
		this.sessions.set(session.id, session);
		return session;
	}

	async updateSshTunnelSession(
		userId: string,
		id: string,
		patch: Partial<SshTunnelSessionRecord>
	): Promise<SshTunnelSessionRecord | null> {
		const session = await this.getSshTunnelSession(userId, id);
		if (!session) return null;
		const updated = { ...session, ...patch, id, userId };
		this.sessions.set(id, updated);
		return updated;
	}
}

export class PersistentSshTunnelRepository implements SshTunnelRepository {
	constructor(private readonly repository: TermixServicesRepository = termixRepository) {}

	async listSshTunnelProfiles(userId: string): Promise<SshTunnelProfileRecord[]> {
		const profiles = await this.repository.listSshTunnelProfiles(userId);
		return profiles.map(toServiceProfile);
	}

	async getSshTunnelProfile(userId: string, id: string): Promise<SshTunnelProfileRecord | null> {
		const profile = await this.repository.getSshTunnelProfile(userId, id);
		return profile ? toServiceProfile(profile) : null;
	}

	async createSshTunnelProfile(profile: SshTunnelProfileRecord): Promise<SshTunnelProfileRecord> {
		const host = await this.repository.getHost(profile.userId, profile.hostId);
		const created = await this.repository.createSshTunnelProfile({
			id: profile.id,
			userId: profile.userId,
			workspaceId: host?.workspaceId ?? null,
			sshHostId: profile.hostId,
			name: profile.name,
			targetHost: profile.targetHost,
			targetPort: profile.targetPort,
			description: null,
			createdAt: profile.createdAt,
			updatedAt: profile.updatedAt
		});
		return toServiceProfile(created);
	}

	async updateSshTunnelProfile(
		userId: string,
		id: string,
		patch: Partial<SshTunnelProfileRecord>
	): Promise<SshTunnelProfileRecord | null> {
		const nextHostId = patch.hostId;
		const host = nextHostId ? await this.repository.getHost(userId, nextHostId) : null;
		const updated = await this.repository.updateSshTunnelProfile(userId, id, {
			...(nextHostId ? { sshHostId: nextHostId, workspaceId: host?.workspaceId ?? null } : {}),
			name: patch.name,
			targetHost: patch.targetHost,
			targetPort: patch.targetPort,
			updatedAt: patch.updatedAt
		});
		return updated ? toServiceProfile(updated) : null;
	}

	deleteSshTunnelProfile(userId: string, id: string): Promise<boolean> {
		return this.repository.deleteSshTunnelProfile(userId, id);
	}

	async listSshTunnelSessions(userId: string): Promise<SshTunnelSessionRecord[]> {
		const sessions = await this.repository.listSshTunnelSessions(userId);
		return sessions.map(toServiceSession);
	}

	async getSshTunnelSession(userId: string, id: string): Promise<SshTunnelSessionRecord | null> {
		const session = await this.repository.getSshTunnelSession(userId, id);
		return session ? toServiceSession(session) : null;
	}

	async createSshTunnelSession(session: SshTunnelSessionRecord): Promise<SshTunnelSessionRecord> {
		const host = await this.repository.getHost(session.userId, session.hostId);
		const created = await this.repository.createSshTunnelSession({
			id: session.id,
			profileId: session.profileId,
			userId: session.userId,
			workspaceId: host?.workspaceId ?? null,
			sshHostId: session.hostId,
			targetHost: session.targetHost,
			targetPort: session.targetPort,
			publicPath: publicSshTunnelPath(session.id),
			status: session.status,
			startedAt: session.startedAt,
			endedAt: session.endedAt,
			lastSeenAt: session.lastUsedAt ?? session.updatedAt,
			errorCode: session.failureCode,
			errorMessage: null
		});
		return toServiceSession(created);
	}

	async updateSshTunnelSession(
		userId: string,
		id: string,
		patch: Partial<SshTunnelSessionRecord>
	): Promise<SshTunnelSessionRecord | null> {
		const updated = await this.repository.updateSshTunnelSession(userId, id, {
			profileId: patch.profileId,
			sshHostId: patch.hostId,
			targetHost: patch.targetHost,
			targetPort: patch.targetPort,
			status: patch.status,
			endedAt: patch.endedAt,
			lastSeenAt: patch.lastUsedAt ?? patch.updatedAt,
			errorCode: patch.failureCode,
			errorMessage: patch.failureCode
		});
		return updated ? toServiceSession(updated) : null;
	}
}

export const defaultSshTunnelRepository = new PersistentSshTunnelRepository();

export function publicSshTunnelPath(sessionId: string, path = ''): string {
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `/api/tunnels/${encodeURIComponent(sessionId)}/proxy${normalizedPath}`;
}

function toServiceProfile(profile: StoredSshTunnelProfileRecord): SshTunnelProfileRecord {
	return {
		id: profile.id,
		userId: profile.userId,
		hostId: profile.sshHostId,
		name: profile.name,
		targetHost: profile.targetHost,
		targetPort: profile.targetPort,
		createdAt: profile.createdAt,
		updatedAt: profile.updatedAt
	};
}

function toServiceSession(session: StoredSshTunnelSessionRecord): SshTunnelSessionRecord {
	return {
		id: session.id,
		userId: session.userId,
		profileId: session.profileId,
		hostId: session.sshHostId ?? '',
		targetHost: session.targetHost,
		targetPort: session.targetPort,
		status: toServiceSessionStatus(session.status),
		failureCode: session.errorCode as SshTunnelFailureCode | null,
		startedAt: session.startedAt,
		lastUsedAt: session.lastSeenAt,
		endedAt: session.endedAt,
		createdAt: session.startedAt,
		updatedAt: session.endedAt ?? session.lastSeenAt
	};
}

function toServiceSessionStatus(
	status: StoredSshTunnelSessionRecord['status']
): SshTunnelSessionStatus {
	if (status === 'starting') return 'active';
	if (status === 'expired') return 'ended';
	return status;
}
