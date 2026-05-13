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
const defaultTerminalCols = 80;
const defaultTerminalRows = 24;

export interface SshLiveSessionServiceOptions {
	attachTicketTtlMs?: number;
	detachedIdleTtlMs?: number;
	maxLiveSessionsPerUser?: number;
}

export interface CreateOrReuseSshLiveSessionInput {
	hostId?: unknown;
	title?: unknown;
	terminalCols?: unknown;
	terminalRows?: unknown;
	now?: Date;
}

export interface CreatedOrReusedSshLiveSession {
	session: SshLiveSessionRecord;
	reused: boolean;
}

export interface CreatedSshAttachTicket {
	ticket: string;
	record: SshAttachTicketRecord;
}

export class SshLiveSessionService {
	private readonly attachTicketTtlMs: number;
	private readonly detachedIdleTtlMs: number;
	private readonly maxLiveSessionsPerUser: number;

	constructor(
		private readonly repository: SshLiveSessionRepository = termixRepository,
		private readonly hosts: HostService = hostService,
		private readonly credentials: Pick<CredentialRepository, 'getCredential'> = termixRepository,
		options: SshLiveSessionServiceOptions = {}
	) {
		this.attachTicketTtlMs = options.attachTicketTtlMs ?? defaultAttachTicketTtlMs;
		this.detachedIdleTtlMs = options.detachedIdleTtlMs ?? defaultDetachedIdleTtlMs;
		this.maxLiveSessionsPerUser = options.maxLiveSessionsPerUser ?? defaultMaxLiveSessionsPerUser;
	}

	list(userId: string): Promise<SshLiveSessionRecord[]> {
		return this.repository.listSshLiveSessions(userId);
	}

	get(userId: string, id: string): Promise<SshLiveSessionRecord> {
		return this.getLiveSession(userId, id, new Date());
	}

	async createOrReuse(
		userId: string,
		input: CreateOrReuseSshLiveSessionInput
	): Promise<CreatedOrReusedSshLiveSession> {
		const { hostId, title, terminalCols, terminalRows } = validateCreateInput(input);
		const host = await this.getSshHostForUser(userId, hostId);
		const now = input.now ?? new Date();
		const reusable = await this.repository.findReusableSshLiveSession(userId, host.id);

		if (reusable && !isExpiredDetachedSession(reusable, now)) {
			const updated = await this.repository.updateSshLiveSession(userId, reusable.id, {
				title: title ?? reusable.title,
				terminalCols,
				terminalRows,
				updatedAt: now
			});
			return { session: updated ?? reusable, reused: true };
		}

		if (reusable) await this.endExpiredSession(userId, reusable, now);

		const openCount = await this.repository.countOpenSshLiveSessions(userId);
		if (openCount >= this.maxLiveSessionsPerUser) {
			throw new ServiceValidationError([
				`live SSH session limit reached (${this.maxLiveSessionsPerUser})`
			]);
		}

		const session = await this.repository.createSshLiveSession({
			id: randomUUID(),
			userId,
			hostId: host.id,
			title: title ?? host.name,
			status: 'starting',
			startedAt: now,
			lastAttachedAt: null,
			detachedAt: null,
			expiresAt: null,
			endedAt: null,
			terminalCols,
			terminalRows,
			createdAt: now,
			updatedAt: now
		});

		return { session, reused: false };
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
		const ticket = randomBytes(32).toString('base64url');
		const record = await this.repository.createSshAttachTicket({
			id: randomUUID(),
			userId,
			sshLiveSessionId: session.id,
			ticketHash: hashToken(ticket),
			expiresAt: new Date(now.getTime() + ttlMs),
			consumedAt: null,
			createdAt: now
		});

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
		if (existing.expiresAt.getTime() <= now.getTime()) throw new TicketExpiredError();

		const session = await this.repository.getSshLiveSession(
			existing.userId,
			existing.sshLiveSessionId
		);
		if (!session || !isLiveStatus(session.status)) throw new TicketInvalidError();
		if (isExpiredDetachedSession(session, now)) {
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
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('SSH live session not found');
		return updated;
	}

	async fail(userId: string, id: string, now = new Date()): Promise<SshLiveSessionRecord> {
		const updated = await this.repository.updateSshLiveSession(userId, id, {
			status: 'failed',
			endedAt: now,
			expiresAt: null,
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
		if (isExpiredDetachedSession(session, now)) {
			await this.endExpiredSession(userId, session, now);
			throw new ServiceValidationError(['SSH live session expired while detached']);
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

function isExpiredDetachedSession(session: SshLiveSessionRecord, now: Date): boolean {
	return (
		session.status === 'detached' &&
		session.expiresAt !== null &&
		session.expiresAt.getTime() <= now.getTime()
	);
}
