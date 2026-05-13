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
	HostProtocol,
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
		if (host.credentialId) {
			const credential = await this.credentials.getCredential(userId, host.credentialId);
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
			target: `${host.protocol}:${host.hostname}:${host.port}`,
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
		if (!ticket) throw new TicketInvalidError();

		const ticketHash = hashToken(ticket);
		const existing = await this.repository.getTicketByHash(ticketHash);
		if (!existing) throw new TicketInvalidError();
		if (userId && existing.userId !== userId) throw new TicketInvalidError();
		if (protocol && existing.protocol !== protocol) throw new TicketInvalidError();
		if (existing.usedAt) throw new TicketConsumedError();
		if (existing.expiresAt.getTime() <= now.getTime()) throw new TicketExpiredError();

		const consumed = await this.repository.consumeTicket(ticketHash, now);
		if (!consumed) throw new TicketConsumedError();
		if (consumed.expiresAt.getTime() <= now.getTime()) throw new TicketExpiredError();

		return consumed;
	}
}

export const sessionTicketService = new SessionTicketService();
