import { randomUUID } from 'node:crypto';
import { ServiceNotFoundError, ServiceValidationError } from './errors';
import { hostService, type HostService } from './hosts';
import { termixRepository } from './repository';
import type { CredentialRepository, HostRecord } from './types';
import { defaultSshTunnelRepository } from './ssh-tunnel-repository';

export {
	InMemorySshTunnelRepository,
	PersistentSshTunnelRepository,
	defaultSshTunnelRepository,
	publicSshTunnelPath
} from './ssh-tunnel-repository';

const defaultMaxProfilesPerUser = 50;
const defaultMaxOpenSessionsPerUser = 5;
const defaultIdleAfterMs = 5 * 60_000;
const openTunnelStatuses = ['active', 'idle'] as const;

export type SshTunnelSessionStatus = 'active' | 'idle' | 'ended' | 'failed';

export type SshTunnelFailureCode =
	| 'access_denied'
	| 'credential_missing'
	| 'credential_username_missing'
	| 'host_not_ssh'
	| 'limit_reached'
	| 'profile_not_found'
	| 'session_ended'
	| 'session_failed'
	| 'ssh_auth_failed'
	| 'ssh_connection_failed'
	| 'ssh_host_key_untrusted'
	| 'target_unreachable'
	| 'tunnel_proxy_failed'
	| 'validation_failed';

export interface SshTunnelProfileRecord {
	id: string;
	userId: string;
	hostId: string;
	name: string;
	targetHost: string;
	targetPort: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface SshTunnelSessionRecord {
	id: string;
	userId: string;
	profileId: string | null;
	hostId: string;
	targetHost: string;
	targetPort: number;
	status: SshTunnelSessionStatus;
	failureCode: SshTunnelFailureCode | null;
	startedAt: Date;
	lastUsedAt: Date | null;
	endedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SshTunnelRepository {
	listSshTunnelProfiles(userId: string): Promise<SshTunnelProfileRecord[]>;
	getSshTunnelProfile(userId: string, id: string): Promise<SshTunnelProfileRecord | null>;
	createSshTunnelProfile(profile: SshTunnelProfileRecord): Promise<SshTunnelProfileRecord>;
	updateSshTunnelProfile(
		userId: string,
		id: string,
		patch: Partial<SshTunnelProfileRecord>
	): Promise<SshTunnelProfileRecord | null>;
	deleteSshTunnelProfile(userId: string, id: string): Promise<boolean>;
	listSshTunnelSessions(userId: string): Promise<SshTunnelSessionRecord[]>;
	getSshTunnelSession(userId: string, id: string): Promise<SshTunnelSessionRecord | null>;
	createSshTunnelSession(session: SshTunnelSessionRecord): Promise<SshTunnelSessionRecord>;
	updateSshTunnelSession(
		userId: string,
		id: string,
		patch: Partial<SshTunnelSessionRecord>
	): Promise<SshTunnelSessionRecord | null>;
}

export interface SshTunnelServiceOptions {
	maxProfilesPerUser?: number;
	maxOpenSessionsPerUser?: number;
	idleAfterMs?: number;
}

export interface SshTunnelProfileInput {
	id?: unknown;
	hostId?: unknown;
	name?: unknown;
	targetHost?: unknown;
	targetPort?: unknown;
}

export interface StartSshTunnelInput {
	profileId?: unknown;
	hostId?: unknown;
	name?: unknown;
	targetHost?: unknown;
	targetPort?: unknown;
}

export class SshTunnelService {
	private readonly maxProfilesPerUser: number;
	private readonly maxOpenSessionsPerUser: number;
	private readonly idleAfterMs: number;
	private readonly startQueues = new Map<string, Promise<void>>();

	constructor(
		private readonly repository: SshTunnelRepository = defaultSshTunnelRepository,
		private readonly hosts: HostService = hostService,
		private readonly credentials: Pick<CredentialRepository, 'getCredential'> = termixRepository,
		options: SshTunnelServiceOptions = {}
	) {
		this.maxProfilesPerUser = options.maxProfilesPerUser ?? defaultMaxProfilesPerUser;
		this.maxOpenSessionsPerUser = options.maxOpenSessionsPerUser ?? defaultMaxOpenSessionsPerUser;
		this.idleAfterMs = options.idleAfterMs ?? defaultIdleAfterMs;
	}

	async listProfiles(userId: string): Promise<SshTunnelProfileRecord[]> {
		const profiles = await this.repository.listSshTunnelProfiles(userId);
		return profiles.sort((left, right) => left.name.localeCompare(right.name));
	}

	async saveProfile(userId: string, input: SshTunnelProfileInput): Promise<SshTunnelProfileRecord> {
		const now = new Date();
		const validated = validateTunnelProfileInput(input);
		await this.validateHostAccess(userId, validated.hostId);

		if (validated.id) {
			const updated = await this.repository.updateSshTunnelProfile(userId, validated.id, {
				hostId: validated.hostId,
				name: validated.name,
				targetHost: validated.targetHost,
				targetPort: validated.targetPort,
				updatedAt: now
			});
			if (!updated) throw new ServiceNotFoundError('SSH tunnel profile not found');
			return updated;
		}

		const existingProfiles = await this.repository.listSshTunnelProfiles(userId);
		if (existingProfiles.length >= this.maxProfilesPerUser) {
			throw new ServiceValidationError([
				`SSH tunnel profile limit reached (${this.maxProfilesPerUser})`
			]);
		}

		return this.repository.createSshTunnelProfile({
			id: randomUUID(),
			userId,
			hostId: validated.hostId,
			name: validated.name,
			targetHost: validated.targetHost,
			targetPort: validated.targetPort,
			createdAt: now,
			updatedAt: now
		});
	}

	async deleteProfile(userId: string, id: string): Promise<void> {
		const profileId = asTrimmedString(id);
		if (!profileId) throw new ServiceValidationError(['profileId is required']);
		const deleted = await this.repository.deleteSshTunnelProfile(userId, profileId);
		if (!deleted) throw new ServiceNotFoundError('SSH tunnel profile not found');
	}

	async startSession(userId: string, input: StartSshTunnelInput): Promise<SshTunnelSessionRecord> {
		return this.withUserStartLock(userId, () => this.startSessionUnlocked(userId, input));
	}

	async listSessions(userId: string, now = new Date()): Promise<SshTunnelSessionRecord[]> {
		const sessions = await this.repository.listSshTunnelSessions(userId);
		const inspected = await Promise.all(
			sessions.map((session) => this.refreshIdleState(userId, session, now))
		);
		return inspected.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
	}

	async inspectSession(
		userId: string,
		sessionId: string,
		now = new Date()
	): Promise<SshTunnelSessionRecord> {
		const id = asTrimmedString(sessionId);
		if (!id) throw new ServiceValidationError(['sessionId is required']);
		const session = await this.repository.getSshTunnelSession(userId, id);
		if (!session) throw new ServiceNotFoundError('SSH tunnel session not found');
		return this.refreshIdleState(userId, session, now);
	}

	async touchSessionForProxy(
		userId: string,
		sessionId: string,
		now = new Date()
	): Promise<SshTunnelSessionRecord> {
		const session = await this.inspectSession(userId, sessionId, now);
		if (session.status === 'ended') {
			throw new ServiceValidationError(['SSH tunnel session has ended']);
		}
		if (session.status === 'failed') {
			throw new ServiceValidationError([
				`SSH tunnel session failed: ${session.failureCode ?? 'tunnel_proxy_failed'}`
			]);
		}
		const updated = await this.repository.updateSshTunnelSession(userId, session.id, {
			status: 'active',
			lastUsedAt: now,
			failureCode: null,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH tunnel session not found');
		return updated;
	}

	async terminateSession(
		userId: string,
		sessionId: string,
		now = new Date()
	): Promise<SshTunnelSessionRecord> {
		const id = asTrimmedString(sessionId);
		if (!id) throw new ServiceValidationError(['sessionId is required']);
		const updated = await this.repository.updateSshTunnelSession(userId, id, {
			status: 'ended',
			endedAt: now,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH tunnel session not found');
		return updated;
	}

	async failSession(
		userId: string,
		sessionId: string,
		failureCode: SshTunnelFailureCode,
		now = new Date()
	): Promise<SshTunnelSessionRecord> {
		const updated = await this.repository.updateSshTunnelSession(userId, sessionId, {
			status: 'failed',
			failureCode,
			endedAt: now,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH tunnel session not found');
		return updated;
	}

	private async startSessionUnlocked(
		userId: string,
		input: StartSshTunnelInput
	): Promise<SshTunnelSessionRecord> {
		const now = new Date();
		const resolved = await this.resolveStartInput(userId, input);
		await this.validateHostAccess(userId, resolved.hostId);

		const sessions = await this.listSessions(userId, now);
		const openSessions = sessions.filter((session) => isOpenTunnelStatus(session.status));
		if (openSessions.length >= this.maxOpenSessionsPerUser) {
			throw new ServiceValidationError([
				`SSH tunnel session limit reached (${this.maxOpenSessionsPerUser})`
			]);
		}

		return this.repository.createSshTunnelSession({
			id: randomUUID(),
			userId,
			profileId: resolved.profileId,
			hostId: resolved.hostId,
			targetHost: resolved.targetHost,
			targetPort: resolved.targetPort,
			status: 'active',
			failureCode: null,
			startedAt: now,
			lastUsedAt: null,
			endedAt: null,
			createdAt: now,
			updatedAt: now
		});
	}

	private async resolveStartInput(
		userId: string,
		input: StartSshTunnelInput
	): Promise<{
		profileId: string | null;
		hostId: string;
		targetHost: string;
		targetPort: number;
	}> {
		const profileId = asTrimmedString(input.profileId);
		if (profileId) {
			const profile = await this.repository.getSshTunnelProfile(userId, profileId);
			if (!profile) throw new ServiceNotFoundError('SSH tunnel profile not found');
			return {
				profileId: profile.id,
				hostId: profile.hostId,
				targetHost: profile.targetHost,
				targetPort: profile.targetPort
			};
		}

		const validated = validateTunnelProfileInput(input);
		return {
			profileId: null,
			hostId: validated.hostId,
			targetHost: validated.targetHost,
			targetPort: validated.targetPort
		};
	}

	private async validateHostAccess(userId: string, hostId: string): Promise<HostRecord> {
		let host: HostRecord;
		try {
			host = await this.hosts.get(userId, hostId);
		} catch (error) {
			if (error instanceof ServiceNotFoundError) {
				throw new ServiceValidationError([
					'hostId must reference an existing host accessible to the user'
				]);
			}
			throw error;
		}

		if (host.protocol !== 'ssh') {
			throw new ServiceValidationError(['SSH tunnels require an SSH host']);
		}

		const credential = host.credentialId
			? await this.credentials.getCredential(userId, host.credentialId)
			: null;
		if (host.credentialId && !credential) {
			throw new ServiceValidationError(['host credential is unavailable']);
		}
		if (!(credential?.username ?? host.username)) {
			throw new ServiceValidationError(['host username or credential username is required']);
		}

		return host;
	}

	private async refreshIdleState(
		userId: string,
		session: SshTunnelSessionRecord,
		now: Date
	): Promise<SshTunnelSessionRecord> {
		if (session.status !== 'active' && session.status !== 'idle') return session;
		const lastActivityAt = session.lastUsedAt ?? session.startedAt;
		if (now.getTime() - lastActivityAt.getTime() < this.idleAfterMs) return session;

		if (session.status === 'idle') {
			const updated = await this.repository.updateSshTunnelSession(userId, session.id, {
				status: 'ended',
				endedAt: now,
				lastUsedAt: now,
				updatedAt: now
			});
			return updated ?? session;
		}

		const updated = await this.repository.updateSshTunnelSession(userId, session.id, {
			status: 'idle',
			lastUsedAt: now,
			updatedAt: now
		});
		return updated ?? session;
	}

	private async withUserStartLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
		const previous = this.startQueues.get(userId) ?? Promise.resolve();
		let releaseCurrent!: () => void;
		const current = new Promise<void>((resolve) => {
			releaseCurrent = resolve;
		});
		const queued = previous.catch(() => undefined).then(() => current);
		this.startQueues.set(userId, queued);

		await previous.catch(() => undefined);
		try {
			return await work();
		} finally {
			releaseCurrent();
			if (this.startQueues.get(userId) === queued) {
				this.startQueues.delete(userId);
			}
		}
	}
}

export const sshTunnelService = new SshTunnelService();

function validateTunnelProfileInput(input: SshTunnelProfileInput): {
	id: string | null;
	hostId: string;
	name: string;
	targetHost: string;
	targetPort: number;
} {
	const issues: string[] = [];
	const id = asTrimmedString(input.id);
	const hostId = asTrimmedString(input.hostId);
	const name = asTrimmedString(input.name);
	const targetHost = validateTargetHost(input.targetHost, issues);
	const targetPort = validateTargetPort(input.targetPort, issues);

	if (!hostId) issues.push('hostId is required');
	if (!name) issues.push('name is required');
	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		id,
		hostId: hostId!,
		name: name!,
		targetHost: targetHost!,
		targetPort: targetPort!
	};
}

function validateTargetHost(value: unknown, issues: string[]): string | null {
	const targetHost = asTrimmedString(value);
	if (!targetHost) {
		issues.push('targetHost is required');
		return null;
	}
	if (targetHost.length > 255) {
		issues.push('targetHost must be at most 255 characters');
		return null;
	}
	if (/[\0\s/?#@\\]/.test(targetHost) || targetHost.includes('://')) {
		issues.push('targetHost must be a hostname or IP address without a scheme or path');
		return null;
	}
	return targetHost;
}

function validateTargetPort(value: unknown, issues: string[]): number | null {
	const port = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		issues.push('targetPort must be an integer between 1 and 65535');
		return null;
	}
	return port;
}

function isOpenTunnelStatus(status: SshTunnelSessionStatus): boolean {
	return openTunnelStatuses.includes(status as (typeof openTunnelStatuses)[number]);
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}
