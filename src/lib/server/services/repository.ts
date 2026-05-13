import { and, eq, isNull } from 'drizzle-orm';
import { db, type TermixDb } from '../db';
import {
	connectionSessions,
	credentials,
	hosts,
	sessionTickets,
	type credentials as credentialsTable,
	type hosts as hostsTable,
	type sessionTickets as sessionTicketsTable
} from '../db/schema';
import type {
	ConnectionSessionPatch,
	ConnectionSessionRecord,
	CredentialRecord,
	HostRecord,
	SessionTicketRecord,
	TermixServicesRepository
} from './types';

type HostRow = typeof hostsTable.$inferSelect;
type CredentialRow = typeof credentialsTable.$inferSelect;
type SessionTicketRow = typeof sessionTicketsTable.$inferSelect;
type ConnectionSessionRow = typeof connectionSessions.$inferSelect;

export class DrizzleTermixServicesRepository implements TermixServicesRepository {
	constructor(private readonly database: TermixDb = db) {}

	async listHosts(userId: string): Promise<HostRecord[]> {
		const rows = await this.database.select().from(hosts).where(eq(hosts.userId, userId));
		return rows.map(toHostRecord);
	}

	async getHost(userId: string, id: string): Promise<HostRecord | null> {
		const [row] = await this.database
			.select()
			.from(hosts)
			.where(and(eq(hosts.id, id), eq(hosts.userId, userId)))
			.limit(1);

		return row ? toHostRecord(row) : null;
	}

	async createHost(host: HostRecord): Promise<HostRecord> {
		const [row] = await this.database
			.insert(hosts)
			.values({
				id: host.id,
				userId: host.userId,
				name: host.name,
				protocol: host.protocol,
				hostname: host.hostname,
				port: host.port,
				username: host.username,
				credentialId: host.credentialId,
				folder: host.folder,
				tags: host.tags,
				notes: host.notes,
				createdAt: host.createdAt,
				updatedAt: host.updatedAt
			})
			.returning();

		if (!row) throw new Error('Could not create host');
		return toHostRecord(row);
	}

	async updateHost(
		userId: string,
		id: string,
		patch: Partial<HostRecord>
	): Promise<HostRecord | null> {
		const [row] = await this.database
			.update(hosts)
			.set(hostPatchToDb(patch))
			.where(and(eq(hosts.id, id), eq(hosts.userId, userId)))
			.returning();

		return row ? toHostRecord(row) : null;
	}

	async deleteHost(userId: string, id: string): Promise<boolean> {
		const rows = await this.database
			.delete(hosts)
			.where(and(eq(hosts.id, id), eq(hosts.userId, userId)))
			.returning({ id: hosts.id });

		return rows.length > 0;
	}

	async listCredentials(userId: string): Promise<CredentialRecord[]> {
		const rows = await this.database
			.select()
			.from(credentials)
			.where(eq(credentials.userId, userId));

		return rows.map(toCredentialRecord);
	}

	async getCredential(userId: string, id: string): Promise<CredentialRecord | null> {
		const [row] = await this.database
			.select()
			.from(credentials)
			.where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
			.limit(1);

		return row ? toCredentialRecord(row) : null;
	}

	async createCredential(credential: CredentialRecord): Promise<CredentialRecord> {
		const [row] = await this.database
			.insert(credentials)
			.values({
				id: credential.id,
				userId: credential.userId,
				name: credential.name,
				kind: credential.kind,
				username: credential.username,
				encryptedSecret: credential.encryptedSecret,
				encryptionMetadata: credential.encryption,
				metadata: credential.metadata,
				createdAt: credential.createdAt,
				updatedAt: credential.updatedAt
			})
			.returning();

		if (!row) throw new Error('Could not create credential');
		return toCredentialRecord(row);
	}

	async updateCredential(
		userId: string,
		id: string,
		patch: Partial<CredentialRecord>
	): Promise<CredentialRecord | null> {
		const [row] = await this.database
			.update(credentials)
			.set(credentialPatchToDb(patch))
			.where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
			.returning();

		return row ? toCredentialRecord(row) : null;
	}

	async deleteCredential(userId: string, id: string): Promise<boolean> {
		const rows = await this.database
			.delete(credentials)
			.where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
			.returning({ id: credentials.id });

		return rows.length > 0;
	}

	async createTicket(ticket: SessionTicketRecord): Promise<SessionTicketRecord> {
		const [row] = await this.database
			.insert(sessionTickets)
			.values({
				id: ticket.id,
				ticketHash: ticket.ticketHash,
				userId: ticket.userId,
				hostId: ticket.hostId,
				protocol: ticket.protocol,
				target: ticketTargetToDb(ticket.target),
				expiresAt: ticket.expiresAt,
				consumedAt: ticket.usedAt,
				createdAt: ticket.createdAt
			})
			.returning();

		if (!row) throw new Error('Could not create session ticket');
		return toSessionTicketRecord(row);
	}

	async getTicketByHash(ticketHash: string): Promise<SessionTicketRecord | null> {
		const [row] = await this.database
			.select()
			.from(sessionTickets)
			.where(eq(sessionTickets.ticketHash, ticketHash))
			.limit(1);

		return row ? toSessionTicketRecord(row) : null;
	}

	async consumeTicket(ticketHash: string, usedAt: Date): Promise<SessionTicketRecord | null> {
		const [row] = await this.database
			.update(sessionTickets)
			.set({ consumedAt: usedAt })
			.where(and(eq(sessionTickets.ticketHash, ticketHash), isNull(sessionTickets.consumedAt)))
			.returning();

		return row ? toSessionTicketRecord(row) : null;
	}

	async createConnectionSession(
		session: ConnectionSessionRecord
	): Promise<ConnectionSessionRecord> {
		const [row] = await this.database
			.insert(connectionSessions)
			.values({
				id: session.id,
				userId: session.userId,
				hostId: session.hostId,
				protocol: session.protocol,
				status: session.status,
				startedAt: session.startedAt,
				endedAt: session.endedAt,
				errorCode: session.errorCode,
				updatedAt: session.updatedAt
			})
			.returning();

		if (!row) throw new Error('Could not create connection session');
		return toConnectionSessionRecord(row);
	}

	async updateConnectionSession(
		id: string,
		patch: ConnectionSessionPatch
	): Promise<ConnectionSessionRecord | null> {
		const [row] = await this.database
			.update(connectionSessions)
			.set(connectionSessionPatchToDb(patch))
			.where(eq(connectionSessions.id, id))
			.returning();

		return row ? toConnectionSessionRecord(row) : null;
	}
}

export class InMemoryTermixServicesRepository implements TermixServicesRepository {
	private readonly hosts = new Map<string, HostRecord>();
	private readonly credentials = new Map<string, CredentialRecord>();
	private readonly tickets = new Map<string, SessionTicketRecord>();
	private readonly connectionSessions = new Map<string, ConnectionSessionRecord>();

	async listHosts(userId: string): Promise<HostRecord[]> {
		return [...this.hosts.values()].filter((host) => host.userId === userId);
	}

	async getHost(userId: string, id: string): Promise<HostRecord | null> {
		const host = this.hosts.get(id);
		return host?.userId === userId ? host : null;
	}

	async createHost(host: HostRecord): Promise<HostRecord> {
		this.hosts.set(host.id, host);
		return host;
	}

	async updateHost(
		userId: string,
		id: string,
		patch: Partial<HostRecord>
	): Promise<HostRecord | null> {
		const host = await this.getHost(userId, id);
		if (!host) return null;

		const updated = { ...host, ...patch, id, userId };
		this.hosts.set(id, updated);
		return updated;
	}

	async deleteHost(userId: string, id: string): Promise<boolean> {
		const host = await this.getHost(userId, id);
		if (!host) return false;
		return this.hosts.delete(id);
	}

	async listCredentials(userId: string): Promise<CredentialRecord[]> {
		return [...this.credentials.values()].filter((credential) => credential.userId === userId);
	}

	async getCredential(userId: string, id: string): Promise<CredentialRecord | null> {
		const credential = this.credentials.get(id);
		return credential?.userId === userId ? credential : null;
	}

	async createCredential(credential: CredentialRecord): Promise<CredentialRecord> {
		this.credentials.set(credential.id, credential);
		return credential;
	}

	async updateCredential(
		userId: string,
		id: string,
		patch: Partial<CredentialRecord>
	): Promise<CredentialRecord | null> {
		const credential = await this.getCredential(userId, id);
		if (!credential) return null;

		const updated = { ...credential, ...patch, id, userId };
		this.credentials.set(id, updated);
		return updated;
	}

	async deleteCredential(userId: string, id: string): Promise<boolean> {
		const credential = await this.getCredential(userId, id);
		if (!credential) return false;
		return this.credentials.delete(id);
	}

	async createTicket(ticket: SessionTicketRecord): Promise<SessionTicketRecord> {
		this.tickets.set(ticket.ticketHash, ticket);
		return ticket;
	}

	async getTicketByHash(ticketHash: string): Promise<SessionTicketRecord | null> {
		return this.tickets.get(ticketHash) ?? null;
	}

	async consumeTicket(ticketHash: string, usedAt: Date): Promise<SessionTicketRecord | null> {
		const ticket = await this.getTicketByHash(ticketHash);
		if (!ticket || ticket.usedAt) return null;

		const consumed = { ...ticket, usedAt };
		this.tickets.set(ticketHash, consumed);
		return consumed;
	}

	async createConnectionSession(
		session: ConnectionSessionRecord
	): Promise<ConnectionSessionRecord> {
		this.connectionSessions.set(session.id, session);
		return session;
	}

	async updateConnectionSession(
		id: string,
		patch: ConnectionSessionPatch
	): Promise<ConnectionSessionRecord | null> {
		const session = this.connectionSessions.get(id);
		if (!session) return null;

		const updated = { ...session, ...patch, id };
		this.connectionSessions.set(id, updated);
		return updated;
	}

	async getConnectionSession(id: string): Promise<ConnectionSessionRecord | null> {
		return this.connectionSessions.get(id) ?? null;
	}
}

function toHostRecord(row: HostRow): HostRecord {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		protocol: row.protocol,
		hostname: row.hostname,
		port: row.port,
		username: row.username,
		credentialId: row.credentialId,
		folder: row.folder,
		tags: row.tags,
		notes: row.notes,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toCredentialRecord(row: CredentialRow): CredentialRecord {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		kind: row.kind,
		username: row.username,
		encryptedSecret: row.encryptedSecret,
		encryption: row.encryptionMetadata,
		metadata: row.metadata,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toSessionTicketRecord(row: SessionTicketRow): SessionTicketRecord {
	return {
		id: row.id,
		ticketHash: row.ticketHash,
		userId: row.userId,
		hostId: row.hostId,
		protocol: row.protocol,
		target: ticketTargetFromDb(row.target),
		expiresAt: row.expiresAt,
		usedAt: row.consumedAt,
		createdAt: row.createdAt
	};
}

function toConnectionSessionRecord(row: ConnectionSessionRow): ConnectionSessionRecord {
	return {
		id: row.id,
		userId: row.userId,
		hostId: row.hostId,
		protocol: row.protocol,
		status: row.status,
		startedAt: row.startedAt,
		endedAt: row.endedAt,
		errorCode: row.errorCode,
		updatedAt: row.updatedAt
	};
}

function hostPatchToDb(patch: Partial<HostRecord>): Partial<typeof hosts.$inferInsert> {
	return {
		name: patch.name,
		protocol: patch.protocol,
		hostname: patch.hostname,
		port: patch.port,
		username: patch.username,
		credentialId: patch.credentialId,
		folder: patch.folder,
		tags: patch.tags,
		notes: patch.notes,
		updatedAt: patch.updatedAt
	};
}

function credentialPatchToDb(
	patch: Partial<CredentialRecord>
): Partial<typeof credentials.$inferInsert> {
	return {
		name: patch.name,
		kind: patch.kind,
		username: patch.username,
		encryptedSecret: patch.encryptedSecret,
		encryptionMetadata: patch.encryption,
		metadata: patch.metadata,
		updatedAt: patch.updatedAt
	};
}

function connectionSessionPatchToDb(
	patch: ConnectionSessionPatch
): Partial<typeof connectionSessions.$inferInsert> {
	return {
		status: patch.status,
		endedAt: patch.endedAt,
		errorCode: patch.errorCode,
		updatedAt: patch.updatedAt
	};
}

function ticketTargetToDb(target?: string): Record<string, unknown> {
	return target ? { value: target } : {};
}

function ticketTargetFromDb(target: Record<string, unknown>): string {
	return typeof target.value === 'string' ? target.value : JSON.stringify(target);
}

export const termixRepository = new DrizzleTermixServicesRepository();
