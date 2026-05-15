import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './crypto';
import {
	ServiceNotFoundError,
	ServiceValidationError,
	TicketConsumedError,
	TicketExpiredError,
	TicketInvalidError
} from './errors';
import { hostService, type HostService } from './hosts';
import { termixRepository } from './repository';
import type {
	CredentialRepository,
	HostRecord,
	SshAttachTicketRecord,
	SshLiveSessionRecord,
	SshLiveSessionRepository
} from './types';

const defaultAttachTicketTtlMs = 60_000;
const defaultDetachedIdleTtlMs = 2 * 60 * 60 * 1_000;
const defaultMaxLiveSessionsPerUser = 10;
const defaultTerminalStatusVisibleMs = 5 * 60_000;
const defaultTerminalCols = 80;
const defaultTerminalRows = 24;

export interface SshLiveSessionServiceOptions {
	attachTicketTtlMs?: number;
	detachedIdleTtlMs?: number;
	maxLiveSessionsPerUser?: number;
	terminalStatusVisibleMs?: number;
}

export interface CreateOrReuseSshLiveSessionInput {
	hostId?: unknown;
	title?: unknown;
	terminalCols?: unknown;
	terminalRows?: unknown;
	reuseExisting?: unknown;
	now?: Date;
}

export interface CreatedOrReusedSshLiveSession {
	session: SshLiveSessionRecord;
	reused: boolean;
}

export interface SshLiveSessionFailureInput {
	errorCode?: string | null;
	errorMessage?: string | null;
	at?: Date;
}

export interface CreatedSshAttachTicket {
	ticket: string;
	record: SshAttachTicketRecord;
}

export class SshLiveSessionService {
	private readonly attachTicketTtlMs: number;
	private readonly detachedIdleTtlMs: number;
	private readonly maxLiveSessionsPerUser: number;
	private readonly terminalStatusVisibleMs: number;
	private readonly createQueues = new Map<string, Promise<void>>();

	constructor(
		private readonly repository: SshLiveSessionRepository = termixRepository,
		private readonly hosts: HostService = hostService,
		private readonly credentials: Pick<CredentialRepository, 'getCredential'> = termixRepository,
		options: SshLiveSessionServiceOptions = {}
	) {
		this.attachTicketTtlMs = options.attachTicketTtlMs ?? defaultAttachTicketTtlMs;
		this.detachedIdleTtlMs = options.detachedIdleTtlMs ?? defaultDetachedIdleTtlMs;
		this.maxLiveSessionsPerUser = options.maxLiveSessionsPerUser ?? defaultMaxLiveSessionsPerUser;
		this.terminalStatusVisibleMs =
			options.terminalStatusVisibleMs ?? defaultTerminalStatusVisibleMs;
	}

	list(userId: string): Promise<SshLiveSessionRecord[]> {
		return this.repository.listSshLiveSessions(userId);
	}

	async listVisible(userId: string, now = new Date()): Promise<SshLiveSessionRecord[]> {
		const sessions = await this.repository.listSshLiveSessions(userId);
		return sessions.filter((session) =>
			isVisibleLiveSshSession(session, now, this.terminalStatusVisibleMs)
		);
	}

	get(userId: string, id: string, now = new Date()): Promise<SshLiveSessionRecord> {
		return this.getLiveSession(userId, id, now);
	}

	async createOrReuse(
		userId: string,
		input: CreateOrReuseSshLiveSessionInput
	): Promise<CreatedOrReusedSshLiveSession> {
		return this.withUserCreateLock(userId, () => this.createOrReuseUnlocked(userId, input));
	}

	private async createOrReuseUnlocked(
		userId: string,
		input: CreateOrReuseSshLiveSessionInput
	): Promise<CreatedOrReusedSshLiveSession> {
		const { hostId, title, terminalCols, terminalRows } = validateCreateInput(input);
		const host = await this.getSshHostForUser(userId, hostId);
		const now = input.now ?? new Date();
		const reuseExisting = input.reuseExisting === true;
		const openSessions = await this.repository.listSshLiveSessions(userId);
		const activeSessions: SshLiveSessionRecord[] = [];

		for (const session of openSessions) {
			if (!isLiveStatus(session.status)) continue;
			if (isExpiredLiveSession(session, now)) {
				await this.endExpiredSession(userId, session, now);
				continue;
			}
			activeSessions.push(session);
		}

		const reusable = activeSessions.find((session) => session.hostId === host.id) ?? null;
		if (reuseExisting && reusable) {
			const updated = await this.repository.updateSshLiveSession(userId, reusable.id, {
				title: title ?? reusable.title,
				terminalCols,
				terminalRows,
				updatedAt: now
			});
			return { session: updated ?? reusable, reused: true };
		}

		if (activeSessions.length >= this.maxLiveSessionsPerUser) {
			throw new ServiceValidationError([
				`live SSH session limit reached (${this.maxLiveSessionsPerUser})`
			]);
		}

		const sessionTitle = uniqueLiveSessionTitle(
			title ?? host.name,
			activeSessions.filter((session) => session.hostId === host.id).map((session) => session.title)
		);
		const session = await this.repository.createSshLiveSession({
			id: randomUUID(),
			userId,
			hostId: host.id,
			title: sessionTitle,
			status: 'starting',
			startedAt: now,
			lastAttachedAt: null,
			detachedAt: null,
			expiresAt: new Date(now.getTime() + this.attachTicketTtlMs),
			endedAt: null,
			errorCode: null,
			errorMessage: null,
			terminalCols,
			terminalRows,
			createdAt: now,
			updatedAt: now
		});

		return { session, reused: false };
	}

	private async withUserCreateLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
		const previous = this.createQueues.get(userId) ?? Promise.resolve();
		let releaseCurrent!: () => void;
		const current = new Promise<void>((resolve) => {
			releaseCurrent = resolve;
		});
		const queued = previous.catch(() => undefined).then(() => current);
		this.createQueues.set(userId, queued);

		await previous.catch(() => undefined);
		try {
			return await work();
		} finally {
			releaseCurrent();
			if (this.createQueues.get(userId) === queued) {
				this.createQueues.delete(userId);
			}
		}
	}

	async rename(
		userId: string,
		id: string,
		titleInput: unknown,
		now = new Date()
	): Promise<SshLiveSessionRecord> {
		const title = asTrimmedString(titleInput);
		if (!title) throw new ServiceValidationError(['title is required']);

		const updated = await this.repository.updateSshLiveSession(userId, id, {
			title,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH live session not found');
		return updated;
	}

	async createAttachTicket(
		userId: string,
		id: string,
		now = new Date(),
		ttlMs = this.attachTicketTtlMs
	): Promise<CreatedSshAttachTicket> {
		if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) {
			throw new ServiceValidationError(['ttlMs must be between 1000 and 300000']);
		}

		const session = await this.getLiveSession(userId, id, now);
		const expiresAt = new Date(now.getTime() + ttlMs);
		const ticket = randomBytes(32).toString('base64url');
		const record = await this.repository.createSshAttachTicket({
			id: randomUUID(),
			userId,
			sshLiveSessionId: session.id,
			ticketHash: hashToken(ticket),
			expiresAt,
			consumedAt: null,
			createdAt: now
		});
		if (session.status === 'starting') {
			await this.repository.updateSshLiveSession(userId, session.id, {
				expiresAt,
				updatedAt: now
			});
		}

		return { ticket, record };
	}

	async consumeAttachTicket(
		ticket: string,
		now = new Date(),
		userId?: string
	): Promise<SshAttachTicketRecord> {
		if (!ticket) throw new TicketInvalidError();

		const ticketHash = hashToken(ticket);
		const existing = await this.repository.getSshAttachTicketByHash(ticketHash);
		if (!existing) throw new TicketInvalidError();
		if (userId && existing.userId !== userId) throw new TicketInvalidError();
		if (existing.consumedAt) throw new TicketConsumedError();

		const session = await this.repository.getSshLiveSession(
			existing.userId,
			existing.sshLiveSessionId
		);
		if (existing.expiresAt.getTime() <= now.getTime()) {
			if (session && isExpiredLiveSession(session, now)) {
				await this.endExpiredSession(existing.userId, session, now);
			}
			throw new TicketExpiredError();
		}
		if (!session || !isLiveStatus(session.status)) throw new TicketInvalidError();
		if (isExpiredLiveSession(session, now)) {
			await this.endExpiredSession(existing.userId, session, now);
			throw new TicketExpiredError();
		}

		const consumed = await this.repository.consumeSshAttachTicket(ticketHash, now);
		if (!consumed) throw new TicketConsumedError();
		return consumed;
	}

	async markAttached(
		userId: string,
		id: string,
		input: Pick<CreateOrReuseSshLiveSessionInput, 'terminalCols' | 'terminalRows'> = {},
		now = new Date()
	): Promise<SshLiveSessionRecord> {
		await this.getLiveSession(userId, id, now);
		const updated = await this.repository.updateSshLiveSession(userId, id, {
			status: 'attached',
			lastAttachedAt: now,
			detachedAt: null,
			expiresAt: null,
			errorCode: null,
			errorMessage: null,
			terminalCols: normalizeDimension(input.terminalCols, defaultTerminalCols),
			terminalRows: normalizeDimension(input.terminalRows, defaultTerminalRows),
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH live session not found');
		return updated;
	}

	async markDetached(userId: string, id: string, now = new Date()): Promise<SshLiveSessionRecord> {
		await this.getLiveSession(userId, id, now);
		const updated = await this.repository.updateSshLiveSession(userId, id, {
			status: 'detached',
			detachedAt: now,
			expiresAt: new Date(now.getTime() + this.detachedIdleTtlMs),
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH live session not found');
		return updated;
	}

	close(userId: string, id: string, now = new Date()): Promise<SshLiveSessionRecord> {
		return this.end(userId, id, now);
	}

	async end(userId: string, id: string, now = new Date()): Promise<SshLiveSessionRecord> {
		const updated = await this.repository.updateSshLiveSession(userId, id, {
			status: 'ended',
			endedAt: now,
			expiresAt: null,
			errorCode: null,
			errorMessage: null,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH live session not found');
		return updated;
	}

	async fail(
		userId: string,
		id: string,
		failure: SshLiveSessionFailureInput | Date = new Date()
	): Promise<SshLiveSessionRecord> {
		const now = failure instanceof Date ? failure : (failure.at ?? new Date());
		const updated = await this.repository.updateSshLiveSession(userId, id, {
			status: 'failed',
			endedAt: now,
			expiresAt: null,
			errorCode:
				failure instanceof Date
					? 'ssh_session_failed'
					: (failure.errorCode ?? 'ssh_session_failed'),
			errorMessage: failure instanceof Date ? null : (failure.errorMessage ?? null),
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH live session not found');
		return updated;
	}

	markStaleOnStartup(now = new Date()): Promise<number> {
		return this.repository.markStaleSshLiveSessions(now);
	}

	expireIdleDetachedSessions(now = new Date()): Promise<SshLiveSessionRecord[]> {
		return this.repository.markExpiredDetachedSshLiveSessions(now);
	}

	private async getSshHostForUser(userId: string, hostId: string): Promise<HostRecord> {
		let host: HostRecord;
		try {
			host = await this.hosts.get(userId, hostId);
		} catch (error) {
			if (error instanceof ServiceNotFoundError) {
				throw new ServiceValidationError([
					'hostId must reference an existing host owned by the user'
				]);
			}
			throw error;
		}

		if (host.protocol !== 'ssh') {
			throw new ServiceValidationError(['hostId must reference an SSH host']);
		}
		if (host.credentialId && !(await this.credentials.getCredential(userId, host.credentialId))) {
			throw new ServiceValidationError([
				'host credential must reference an existing credential owned by the user'
			]);
		}
		return host;
	}

	private async getLiveSession(
		userId: string,
		id: string,
		now: Date
	): Promise<SshLiveSessionRecord> {
		const session = await this.repository.getSshLiveSession(userId, id);
		if (!session) throw new ServiceNotFoundError('SSH live session not found');
		if (!isLiveStatus(session.status)) {
			throw new ServiceValidationError(['SSH live session is not attachable']);
		}
		if (isExpiredLiveSession(session, now)) {
			await this.endExpiredSession(userId, session, now);
			throw new ServiceValidationError([expiredLiveSessionMessage(session)]);
		}
		return session;
	}

	private async endExpiredSession(
		userId: string,
		session: SshLiveSessionRecord,
		now: Date
	): Promise<void> {
		await this.repository.updateSshLiveSession(userId, session.id, {
			status: 'ended',
			endedAt: now,
			expiresAt: null,
			updatedAt: now
		});
	}
}

export const sshLiveSessionService = new SshLiveSessionService();

function validateCreateInput(input: CreateOrReuseSshLiveSessionInput): {
	hostId: string;
	title: string | null;
	terminalCols: number;
	terminalRows: number;
} {
	const issues: string[] = [];
	const hostId = asTrimmedString(input.hostId);
	const terminalCols = normalizeDimension(input.terminalCols, defaultTerminalCols);
	const terminalRows = normalizeDimension(input.terminalRows, defaultTerminalRows);

	if (!hostId) issues.push('hostId is required');
	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		hostId: hostId!,
		title: asTrimmedString(input.title),
		terminalCols,
		terminalRows
	};
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function normalizeDimension(value: unknown, fallback: number): number {
	const dimension =
		typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
	return Math.min(Math.max(dimension, 1), 500);
}

function isLiveStatus(status: SshLiveSessionRecord['status']): boolean {
	return status === 'starting' || status === 'attached' || status === 'detached';
}

function isVisibleLiveSshSession(
	session: SshLiveSessionRecord,
	now: Date,
	terminalStatusVisibleMs: number
): boolean {
	if (isLiveStatus(session.status) || session.status === 'stale') return true;
	if (session.status !== 'ended' && session.status !== 'failed') return false;
	const terminalAt = session.endedAt ?? session.updatedAt;
	return now.getTime() - terminalAt.getTime() <= terminalStatusVisibleMs;
}

function isExpiredLiveSession(session: SshLiveSessionRecord, now: Date): boolean {
	return (
		(session.status === 'starting' || session.status === 'detached') &&
		session.expiresAt !== null &&
		session.expiresAt.getTime() <= now.getTime()
	);
}

function expiredLiveSessionMessage(session: SshLiveSessionRecord): string {
	return session.status === 'starting'
		? 'SSH live session expired before attachment'
		: 'SSH live session expired while detached';
}

function uniqueLiveSessionTitle(baseTitle: string, existingTitles: string[]): string {
	const used = new Set(existingTitles);
	if (!used.has(baseTitle)) return baseTitle;

	for (let index = 2; index < 1000; index += 1) {
		const candidate = `${baseTitle} ${index}`;
		if (!used.has(candidate)) return candidate;
	}

	return `${baseTitle} ${randomUUID().slice(0, 8)}`;
}
