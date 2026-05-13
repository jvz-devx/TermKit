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
	CredentialRecord,
	CredentialRepository,
	HostProtocol,
	HostRecord,
	SessionTicketRecord,
	SessionTicketRepository
} from './types';
import { protocols } from './types';

const defaultTicketTtlMs = 60_000;

export interface CreateSessionTicketInput {
	hostId?: unknown;
	protocol?: unknown;
	ttlMs?: unknown;
	now?: Date;
}

export interface CreatedSessionTicket {
	ticket: string;
	record: SessionTicketRecord;
}

export interface SessionTicketTargetSnapshot {
	version: 1;
	host: {
		id: string;
		protocol: HostProtocol;
		hostname: string;
		port: number;
		username: string | null;
		credentialId: string | null;
		metadata: Record<string, unknown>;
	};
	credential: {
		id: string;
		kind: CredentialRecord['kind'];
		username: string | null;
		fingerprint: string;
	} | null;
}

export class SessionTicketService {
	constructor(
		private readonly repository: SessionTicketRepository = termixRepository,
		private readonly hosts: HostService = hostService,
		private readonly credentials: CredentialRepository = termixRepository
	) {}

	async create(userId: string, input: CreateSessionTicketInput): Promise<CreatedSessionTicket> {
		const issues: string[] = [];
		const hostId = typeof input.hostId === 'string' ? input.hostId : null;
		const protocol = input.protocol;
		const ttlMs =
			typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs)
				? Math.trunc(input.ttlMs)
				: defaultTicketTtlMs;

		if (!hostId) issues.push('hostId is required');
		if (!protocols.includes(protocol as HostProtocol))
			issues.push('protocol must be ssh, rdp, vnc, or telnet');
		if (ttlMs < 1_000 || ttlMs > 300_000) issues.push('ttlMs must be between 1000 and 300000');
		if (issues.length > 0) throw new ServiceValidationError(issues);

		let host;
		try {
			host = await this.hosts.get(userId, hostId!);
		} catch (error) {
			if (error instanceof ServiceNotFoundError) {
				throw new ServiceValidationError([
					'hostId must reference an existing host owned by the user'
				]);
			}
			throw error;
		}
		if (protocol !== host.protocol) {
			throw new ServiceValidationError(['protocol must match the selected host']);
		}
		let credential: CredentialRecord | null = null;
		if (host.credentialId) {
			credential = await this.credentials.getCredential(userId, host.credentialId);
			if (!credential) {
				throw new ServiceValidationError([
					'host credential must reference an existing credential owned by the user'
				]);
			}
		}

		const now = input.now ?? new Date();
		const ticket = randomBytes(32).toString('base64url');
		const record = await this.repository.createTicket({
			id: randomUUID(),
			ticketHash: hashToken(ticket),
			userId,
			hostId: host.id,
			protocol: protocol as HostProtocol,
			target: serializeSessionTicketTargetSnapshot(createTargetSnapshot(host, credential)),
			expiresAt: new Date(now.getTime() + ttlMs),
			usedAt: null,
			createdAt: now
		});

		return { ticket, record };
	}

	async consume(
		ticket: string,
		now = new Date(),
		userId?: string,
		protocol?: HostProtocol
	): Promise<SessionTicketRecord> {
		const existing = await this.validateForConsume(ticket, now, userId, protocol);
		const consumed = await this.repository.consumeTicket(existing.ticketHash, now);
		if (!consumed) throw new TicketConsumedError();
		if (consumed.expiresAt.getTime() <= now.getTime()) throw new TicketExpiredError();

		return consumed;
	}

	async validateForConsume(
		ticket: string,
		now = new Date(),
		userId?: string,
		protocol?: HostProtocol
	): Promise<SessionTicketRecord> {
		if (!ticket) throw new TicketInvalidError();

		const ticketHash = hashToken(ticket);
		const existing = await this.repository.getTicketByHash(ticketHash);
		if (!existing) throw new TicketInvalidError();
		if (userId && existing.userId !== userId) throw new TicketInvalidError();
		if (protocol && existing.protocol !== protocol) throw new TicketInvalidError();
		if (existing.usedAt) throw new TicketConsumedError();
		if (existing.expiresAt.getTime() <= now.getTime()) throw new TicketExpiredError();
		await this.assertTargetUnchanged(existing);

		return existing;
	}

	private async assertTargetUnchanged(record: SessionTicketRecord): Promise<void> {
		const snapshot = parseSessionTicketTargetSnapshot(record);
		let host: HostRecord;

		try {
			host = await this.hosts.get(record.userId, record.hostId);
		} catch (error) {
			if (error instanceof ServiceNotFoundError) throw new TicketInvalidError();
			throw error;
		}

		if (
			host.id !== snapshot.host.id ||
			host.protocol !== snapshot.host.protocol ||
			host.hostname !== snapshot.host.hostname ||
			host.port !== snapshot.host.port ||
			host.username !== snapshot.host.username ||
			host.credentialId !== snapshot.host.credentialId ||
			stableStringify(host.metadata) !== stableStringify(snapshot.host.metadata)
		) {
			throw new TicketInvalidError();
		}

		if (!snapshot.credential) return;

		const credential = await this.credentials.getCredential(record.userId, snapshot.credential.id);
		if (
			!credential ||
			credential.id !== snapshot.credential.id ||
			credential.kind !== snapshot.credential.kind ||
			credential.username !== snapshot.credential.username ||
			credentialFingerprint(credential) !== snapshot.credential.fingerprint
		) {
			throw new TicketInvalidError();
		}
	}
}

export const sessionTicketService = new SessionTicketService();

export function parseSessionTicketTargetSnapshot(
	record: SessionTicketRecord
): SessionTicketTargetSnapshot {
	if (!record.target) throw new TicketInvalidError();

	try {
		const parsed = JSON.parse(record.target) as unknown;
		if (!isSessionTicketTargetSnapshot(parsed)) throw new TicketInvalidError();
		return parsed;
	} catch (error) {
		if (error instanceof TicketInvalidError) throw error;
		throw new TicketInvalidError();
	}
}

function createTargetSnapshot(
	host: HostRecord,
	credential: CredentialRecord | null
): SessionTicketTargetSnapshot {
	return {
		version: 1,
		host: {
			id: host.id,
			protocol: host.protocol,
			hostname: host.hostname,
			port: host.port,
			username: host.username,
			credentialId: host.credentialId,
			metadata: host.metadata
		},
		credential: credential
			? {
					id: credential.id,
					kind: credential.kind,
					username: credential.username,
					fingerprint: credentialFingerprint(credential)
				}
			: null
	};
}

function serializeSessionTicketTargetSnapshot(snapshot: SessionTicketTargetSnapshot): string {
	return JSON.stringify(snapshot);
}

function credentialFingerprint(credential: CredentialRecord): string {
	return hashToken(
		stableStringify({
			id: credential.id,
			userId: credential.userId,
			kind: credential.kind,
			username: credential.username,
			encryptedSecret: credential.encryptedSecret,
			encryption: credential.encryption,
			metadata: credential.metadata
		})
	);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
		.join(',')}}`;
}

function isSessionTicketTargetSnapshot(value: unknown): value is SessionTicketTargetSnapshot {
	if (!isRecord(value)) return false;
	if (value.version !== 1 || !isRecord(value.host)) return false;

	const host = value.host;
	if (
		typeof host.id !== 'string' ||
		!protocols.includes(host.protocol as HostProtocol) ||
		typeof host.hostname !== 'string' ||
		typeof host.port !== 'number' ||
		!Number.isSafeInteger(host.port) ||
		!(typeof host.username === 'string' || host.username === null) ||
		!(typeof host.credentialId === 'string' || host.credentialId === null) ||
		!isRecord(host.metadata)
	) {
		return false;
	}

	if (value.credential === null) return true;
	if (!isRecord(value.credential)) return false;

	const credential = value.credential;
	return (
		typeof credential.id === 'string' &&
		(credential.kind === 'password' || credential.kind === 'ssh_key') &&
		(typeof credential.username === 'string' || credential.username === null) &&
		typeof credential.fingerprint === 'string'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
