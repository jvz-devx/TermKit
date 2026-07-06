import { randomUUID } from 'node:crypto';
import { ServiceNotFoundError, ServiceValidationError } from './errors';
import { hostService, type HostService } from './hosts';
import { termixRepository } from './repository';
import type {
	HostRecord,
	RdpLiveSessionRecord,
	RdpLiveSessionRepository,
	RdpLiveSessionStatus
} from './types';

const defaultStatusVisibleMs = 5 * 60_000;
const defaultMaxLiveSessionsPerUser = 10;
const openStatuses: RdpLiveSessionStatus[] = ['active', 'detached'];

export interface RdpLiveSessionServiceOptions {
	statusVisibleMs?: number;
	maxLiveSessionsPerUser?: number;
}

export interface CreateRdpLiveSessionInput {
	hostId?: unknown;
	title?: unknown;
	now?: Date;
}

export class RdpLiveSessionService {
	private readonly statusVisibleMs: number;
	private readonly maxLiveSessionsPerUser: number;

	constructor(
		private readonly repository: RdpLiveSessionRepository = termixRepository,
		private readonly hosts: HostService = hostService,
		options: RdpLiveSessionServiceOptions = {}
	) {
		this.statusVisibleMs = options.statusVisibleMs ?? defaultStatusVisibleMs;
		this.maxLiveSessionsPerUser = options.maxLiveSessionsPerUser ?? defaultMaxLiveSessionsPerUser;
	}

	list(userId: string): Promise<RdpLiveSessionRecord[]> {
		return this.repository.listRdpLiveSessions(userId);
	}

	async listVisible(userId: string, now = new Date()): Promise<RdpLiveSessionRecord[]> {
		const sessions = await this.list(userId);
		return sessions.filter((session) =>
			isVisibleRdpLiveSession(session, now, this.statusVisibleMs)
		);
	}

	async create(userId: string, input: CreateRdpLiveSessionInput): Promise<RdpLiveSessionRecord> {
		const hostId = asTrimmedString(input.hostId);
		if (!hostId) throw new ServiceValidationError(['hostId is required']);
		const host = await this.getRdpHostForUser(userId, hostId);
		const now = input.now ?? new Date();
		const openSessions = (await this.repository.listRdpLiveSessions(userId)).filter((session) =>
			openStatuses.includes(session.status)
		);
		if (openSessions.length >= this.maxLiveSessionsPerUser) {
			throw new ServiceValidationError([
				`live RDP session limit reached (${this.maxLiveSessionsPerUser})`
			]);
		}
		const title = uniqueLiveSessionTitle(
			asTrimmedString(input.title) ?? host.name,
			openSessions.filter((session) => session.hostId === host.id).map((session) => session.title)
		);

		return this.repository.createRdpLiveSession({
			id: randomUUID(),
			userId,
			hostId: host.id,
			title,
			status: 'detached',
			startedAt: now,
			lastAttachedAt: null,
			endedAt: null,
			errorCode: null,
			errorMessage: null,
			createdAt: now,
			updatedAt: now
		});
	}

	async prepareAttach(userId: string, id: string, now = new Date()): Promise<RdpLiveSessionRecord> {
		const session = await this.getOpenSession(userId, id);
		const updated = await this.repository.updateRdpLiveSession(userId, session.id, {
			status: 'active',
			lastAttachedAt: now,
			errorCode: null,
			errorMessage: null,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('RDP live session not found');
		return updated;
	}

	async rename(userId: string, id: string, titleInput: unknown, now = new Date()) {
		const title = asTrimmedString(titleInput);
		if (!title) throw new ServiceValidationError(['title is required']);
		const updated = await this.repository.updateRdpLiveSession(userId, id, {
			title,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('RDP live session not found');
		return updated;
	}

	async detach(userId: string, id: string, now = new Date()): Promise<RdpLiveSessionRecord> {
		const session = await this.getOpenSession(userId, id);
		const updated = await this.repository.updateRdpLiveSession(userId, session.id, {
			status: 'detached',
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('RDP live session not found');
		return updated;
	}

	async close(userId: string, id: string, now = new Date()): Promise<RdpLiveSessionRecord> {
		const updated = await this.repository.updateRdpLiveSession(userId, id, {
			status: 'ended',
			endedAt: now,
			errorCode: null,
			errorMessage: null,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('RDP live session not found');
		return updated;
	}

	private async getOpenSession(userId: string, id: string): Promise<RdpLiveSessionRecord> {
		const session = await this.repository.getRdpLiveSession(userId, id);
		if (!session || !openStatuses.includes(session.status)) {
			throw new ServiceNotFoundError('RDP live session not found');
		}
		return session;
	}

	private async getRdpHostForUser(userId: string, hostId: string): Promise<HostRecord> {
		const host = await this.hosts.get(userId, hostId);
		if (host.protocol !== 'rdp') {
			throw new ServiceValidationError(['RDP sessions require an RDP host']);
		}
		return host;
	}
}

export function isVisibleRdpLiveSession(
	session: RdpLiveSessionRecord,
	now = new Date(),
	statusVisibleMs = defaultStatusVisibleMs
): boolean {
	if (openStatuses.includes(session.status)) return true;
	const endedAt = session.endedAt ?? session.updatedAt;
	return now.getTime() - endedAt.getTime() <= statusVisibleMs;
}

function asTrimmedString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function uniqueLiveSessionTitle(title: string, existingTitles: string[]): string {
	if (!existingTitles.includes(title)) return title;
	for (let index = 2; index <= 99; index += 1) {
		const candidate = `${title} ${index}`;
		if (!existingTitles.includes(candidate)) return candidate;
	}
	return `${title} ${Date.now()}`;
}

export const rdpLiveSessionService = new RdpLiveSessionService();
