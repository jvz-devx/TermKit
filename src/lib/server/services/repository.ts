import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, type TermixDb } from '../db';
import * as schema from '../db/schema';
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
	SshAttachTicketRecord,
	SshLiveSessionPatch,
	SshLiveSessionRecord,
	SessionTicketRecord,
	TermixServicesRepository
} from './types';

type IntendedSshLiveSessionsTable = typeof connectionSessions & {
	title: typeof connectionSessions.errorCode;
	status: typeof hosts.name;
	hostId: typeof hosts.id;
	lastAttachedAt: typeof connectionSessions.endedAt;
	detachedAt: typeof connectionSessions.endedAt;
	expiresAt: typeof connectionSessions.endedAt;
	terminalCols: typeof connectionSessions.hostId;
	terminalRows: typeof connectionSessions.hostId;
	createdAt: typeof connectionSessions.startedAt;
};
type IntendedSshAttachTicketsTable = typeof sessionTickets & {
	sshLiveSessionId: typeof sessionTickets.hostId;
	consumedAt: typeof sessionTickets.consumedAt;
};
type ReturningInsert = {
	values(values: unknown): {
		returning(): Promise<unknown[]>;
	};
};
type ReturningUpdate = {
	set(values: unknown): {
		where(condition: unknown): {
			returning(fields?: unknown): Promise<unknown[]>;
		};
	};
};

type HostRow = typeof hostsTable.$inferSelect;
type CredentialRow = typeof credentialsTable.$inferSelect;
type SessionTicketRow = typeof sessionTicketsTable.$inferSelect;
type ConnectionSessionRow = typeof connectionSessions.$inferSelect;
type SshLiveSessionRow = SshLiveSessionRecord;
type SshAttachTicketRow = SshAttachTicketRecord;

const intendedSchema = schema as unknown as {
	sshLiveSessions?: IntendedSshLiveSessionsTable;
	sshAttachTickets?: IntendedSshAttachTicketsTable;
};

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
				metadata: host.metadata,
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

	async getConnectionSession(id: string): Promise<ConnectionSessionRecord | null> {
		const [row] = await this.database
			.select()
			.from(connectionSessions)
			.where(eq(connectionSessions.id, id))
			.limit(1);

		return row ? toConnectionSessionRecord(row) : null;
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

	async listSshLiveSessions(userId: string): Promise<SshLiveSessionRecord[]> {
		const { sshLiveSessions } = getSshLiveSchema();
		const rows = await this.database
			.select()
			.from(sshLiveSessions)
			.where(eq(sshLiveSessions.userId, userId));

		return (rows as unknown as SshLiveSessionRow[]).map(toSshLiveSessionRecord);
	}

	async getSshLiveSession(userId: string, id: string): Promise<SshLiveSessionRecord | null> {
		const { sshLiveSessions } = getSshLiveSchema();
		const [row] = await this.database
			.select()
			.from(sshLiveSessions)
			.where(and(eq(sshLiveSessions.id, id), eq(sshLiveSessions.userId, userId)))
			.limit(1);

		return row ? toSshLiveSessionRecord(row as unknown as SshLiveSessionRow) : null;
	}

	async findReusableSshLiveSession(
		userId: string,
		hostId: string
	): Promise<SshLiveSessionRecord | null> {
		const { sshLiveSessions } = getSshLiveSchema();
		const [row] = await this.database
			.select()
			.from(sshLiveSessions)
			.where(
				and(
					eq(sshLiveSessions.userId, userId),
					eq(sshLiveSessions.hostId as typeof hosts.id, hostId),
					inArray(sshLiveSessions.status as typeof hosts.name, ['starting', 'attached', 'detached'])
				)
			)
			.limit(1);

		return row ? toSshLiveSessionRecord(row as unknown as SshLiveSessionRow) : null;
	}

	async countOpenSshLiveSessions(userId: string): Promise<number> {
		const sessions = await this.listSshLiveSessions(userId);
		return sessions.filter((session) => isOpenSshLiveSessionStatus(session.status)).length;
	}

	async createSshLiveSession(session: SshLiveSessionRecord): Promise<SshLiveSessionRecord> {
		const { sshLiveSessions } = getSshLiveSchema();
		const [row] = await (this.database.insert(sshLiveSessions) as unknown as ReturningInsert)
			.values(toSshLiveSessionInsert(session))
			.returning();

		if (!row) throw new Error('Could not create SSH live session');
		return toSshLiveSessionRecord(row as unknown as SshLiveSessionRow);
	}

	async updateSshLiveSession(
		userId: string,
		id: string,
		patch: SshLiveSessionPatch
	): Promise<SshLiveSessionRecord | null> {
		const { sshLiveSessions } = getSshLiveSchema();
		const statusGuard = requiresOpenSshLiveSessionUpdate(patch)
			? inArray(sshLiveSessions.status as typeof hosts.name, ['starting', 'attached', 'detached'])
			: undefined;
		const [row] = await (this.database.update(sshLiveSessions) as unknown as ReturningUpdate)
			.set(sshLiveSessionPatchToDb(patch))
			.where(
				statusGuard
					? and(eq(sshLiveSessions.id, id), eq(sshLiveSessions.userId, userId), statusGuard)
					: and(eq(sshLiveSessions.id, id), eq(sshLiveSessions.userId, userId))
			)
			.returning();

		return row ? toSshLiveSessionRecord(row as unknown as SshLiveSessionRow) : null;
	}

	async markStaleSshLiveSessions(now: Date): Promise<number> {
		const { sshLiveSessions } = getSshLiveSchema();
		const rows = await (this.database.update(sshLiveSessions) as unknown as ReturningUpdate)
			.set({ status: 'stale', endedAt: now, updatedAt: now })
			.where(
				and(
					inArray(sshLiveSessions.status as typeof hosts.name, [
						'starting',
						'attached',
						'detached'
					]),
					lte(sshLiveSessions.createdAt, now)
				)
			)
			.returning({ id: sshLiveSessions.id });

		return rows.length;
	}

	async markExpiredDetachedSshLiveSessions(now: Date): Promise<SshLiveSessionRecord[]> {
		const { sshLiveSessions } = getSshLiveSchema();
		const rows = await (this.database.update(sshLiveSessions) as unknown as ReturningUpdate)
			.set({ status: 'ended', endedAt: now, updatedAt: now })
			.where(
				and(
					or(
						eq(sshLiveSessions.status as typeof hosts.name, 'starting'),
						eq(sshLiveSessions.status as typeof hosts.name, 'detached')
					),
					lte(sshLiveSessions.expiresAt, now)
				)
			)
			.returning();

		return (rows as unknown as SshLiveSessionRow[]).map(toSshLiveSessionRecord);
	}

	async createSshAttachTicket(ticket: SshAttachTicketRecord): Promise<SshAttachTicketRecord> {
		const { sshAttachTickets } = getSshLiveSchema();
		const [row] = await (this.database.insert(sshAttachTickets) as unknown as ReturningInsert)
			.values({
				id: ticket.id,
				userId: ticket.userId,
				sshLiveSessionId: ticket.sshLiveSessionId,
				ticketHash: ticket.ticketHash,
				expiresAt: ticket.expiresAt,
				consumedAt: ticket.consumedAt,
				createdAt: ticket.createdAt
			})
			.returning();

		if (!row) throw new Error('Could not create SSH attach ticket');
		return toSshAttachTicketRecord(row as unknown as SshAttachTicketRow);
	}

	async getSshAttachTicketByHash(ticketHash: string): Promise<SshAttachTicketRecord | null> {
		const { sshAttachTickets } = getSshLiveSchema();
		const [row] = await this.database
			.select()
			.from(sshAttachTickets)
			.where(eq(sshAttachTickets.ticketHash, ticketHash))
			.limit(1);

		return row ? toSshAttachTicketRecord(row as unknown as SshAttachTicketRow) : null;
	}

	async consumeSshAttachTicket(
		ticketHash: string,
		consumedAt: Date
	): Promise<SshAttachTicketRecord | null> {
		const { sshAttachTickets } = getSshLiveSchema();
		const [row] = await (this.database.update(sshAttachTickets) as unknown as ReturningUpdate)
			.set({ consumedAt })
			.where(and(eq(sshAttachTickets.ticketHash, ticketHash), isNull(sshAttachTickets.consumedAt)))
			.returning();

		return row ? toSshAttachTicketRecord(row as unknown as SshAttachTicketRow) : null;
	}
}

export class InMemoryTermixServicesRepository implements TermixServicesRepository {
	private readonly hosts = new Map<string, HostRecord>();
	private readonly credentials = new Map<string, CredentialRecord>();
	private readonly tickets = new Map<string, SessionTicketRecord>();
	private readonly connectionSessions = new Map<string, ConnectionSessionRecord>();
	private readonly sshLiveSessions = new Map<string, SshLiveSessionRecord>();
	private readonly sshAttachTickets = new Map<string, SshAttachTicketRecord>();

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

	async listSshLiveSessions(userId: string): Promise<SshLiveSessionRecord[]> {
		return [...this.sshLiveSessions.values()].filter((session) => session.userId === userId);
	}

	async getSshLiveSession(userId: string, id: string): Promise<SshLiveSessionRecord | null> {
		const session = this.sshLiveSessions.get(id);
		return session?.userId === userId ? session : null;
	}

	async findReusableSshLiveSession(
		userId: string,
		hostId: string
	): Promise<SshLiveSessionRecord | null> {
		return (
			[...this.sshLiveSessions.values()].find(
				(session) =>
					session.userId === userId &&
					session.hostId === hostId &&
					isOpenSshLiveSessionStatus(session.status)
			) ?? null
		);
	}

	async countOpenSshLiveSessions(userId: string): Promise<number> {
		return [...this.sshLiveSessions.values()].filter(
			(session) => session.userId === userId && isOpenSshLiveSessionStatus(session.status)
		).length;
	}

	async createSshLiveSession(session: SshLiveSessionRecord): Promise<SshLiveSessionRecord> {
		this.sshLiveSessions.set(session.id, session);
		return session;
	}

	async updateSshLiveSession(
		userId: string,
		id: string,
		patch: SshLiveSessionPatch
	): Promise<SshLiveSessionRecord | null> {
		const session = await this.getSshLiveSession(userId, id);
		if (!session) return null;
		if (requiresOpenSshLiveSessionUpdate(patch) && !isOpenSshLiveSessionStatus(session.status)) {
			return null;
		}

		const updated = { ...session, ...patch, id, userId };
		this.sshLiveSessions.set(id, updated);
		return updated;
	}

	async markStaleSshLiveSessions(now: Date): Promise<number> {
		let count = 0;
		for (const session of this.sshLiveSessions.values()) {
			if (!isOpenSshLiveSessionStatus(session.status)) continue;
			if (session.createdAt.getTime() > now.getTime()) continue;
			this.sshLiveSessions.set(session.id, {
				...session,
				status: 'stale',
				endedAt: now,
				updatedAt: now
			});
			count += 1;
		}
		return count;
	}

	async markExpiredDetachedSshLiveSessions(now: Date): Promise<SshLiveSessionRecord[]> {
		const expired: SshLiveSessionRecord[] = [];
		for (const session of this.sshLiveSessions.values()) {
			if (
				(session.status !== 'starting' && session.status !== 'detached') ||
				!session.expiresAt ||
				session.expiresAt.getTime() > now.getTime()
			) {
				continue;
			}
			const updated: SshLiveSessionRecord = {
				...session,
				status: 'ended',
				endedAt: now,
				updatedAt: now
			};
			this.sshLiveSessions.set(session.id, updated);
			expired.push(updated);
		}
		return expired;
	}

	async createSshAttachTicket(ticket: SshAttachTicketRecord): Promise<SshAttachTicketRecord> {
		this.sshAttachTickets.set(ticket.ticketHash, ticket);
		return ticket;
	}

	async getSshAttachTicketByHash(ticketHash: string): Promise<SshAttachTicketRecord | null> {
		return this.sshAttachTickets.get(ticketHash) ?? null;
	}

	async consumeSshAttachTicket(
		ticketHash: string,
		consumedAt: Date
	): Promise<SshAttachTicketRecord | null> {
		const ticket = await this.getSshAttachTicketByHash(ticketHash);
		if (!ticket || ticket.consumedAt) return null;

		const consumed = { ...ticket, consumedAt };
		this.sshAttachTickets.set(ticketHash, consumed);
		return consumed;
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
		metadata: row.metadata ?? {},
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

function toSshLiveSessionRecord(row: SshLiveSessionRow): SshLiveSessionRecord {
	return {
		id: row.id,
		userId: row.userId,
		hostId: row.hostId,
		title: row.title,
		status: row.status,
		startedAt: row.startedAt,
		lastAttachedAt: row.lastAttachedAt,
		detachedAt: row.detachedAt,
		expiresAt: row.expiresAt,
		endedAt: row.endedAt,
		terminalCols: row.terminalCols,
		terminalRows: row.terminalRows,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toSshAttachTicketRecord(row: SshAttachTicketRow): SshAttachTicketRecord {
	return {
		id: row.id,
		userId: row.userId,
		sshLiveSessionId: row.sshLiveSessionId,
		ticketHash: row.ticketHash,
		expiresAt: row.expiresAt,
		consumedAt: row.consumedAt,
		createdAt: row.createdAt
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
		metadata: patch.metadata,
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

function toSshLiveSessionInsert(session: SshLiveSessionRecord): Record<string, unknown> {
	return {
		id: session.id,
		userId: session.userId,
		hostId: session.hostId,
		title: session.title,
		status: session.status,
		startedAt: session.startedAt,
		lastAttachedAt: session.lastAttachedAt,
		detachedAt: session.detachedAt,
		expiresAt: session.expiresAt,
		endedAt: session.endedAt,
		terminalCols: session.terminalCols,
		terminalRows: session.terminalRows,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt
	};
}

function sshLiveSessionPatchToDb(patch: SshLiveSessionPatch): Record<string, unknown> {
	return {
		title: patch.title,
		status: patch.status,
		lastAttachedAt: patch.lastAttachedAt,
		detachedAt: patch.detachedAt,
		expiresAt: patch.expiresAt,
		endedAt: patch.endedAt,
		terminalCols: patch.terminalCols,
		terminalRows: patch.terminalRows,
		updatedAt: patch.updatedAt
	};
}

function getSshLiveSchema(): {
	sshLiveSessions: IntendedSshLiveSessionsTable;
	sshAttachTickets: IntendedSshAttachTicketsTable;
} {
	if (!intendedSchema.sshLiveSessions || !intendedSchema.sshAttachTickets) {
		throw new Error(
			'SSH live session schema is not available; expected sshLiveSessions and sshAttachTickets exports backed by ssh_live_sessions and ssh_attach_tickets'
		);
	}

	return {
		sshLiveSessions: intendedSchema.sshLiveSessions,
		sshAttachTickets: intendedSchema.sshAttachTickets
	};
}

function isOpenSshLiveSessionStatus(status: SshLiveSessionRecord['status']): boolean {
	return status === 'starting' || status === 'attached' || status === 'detached';
}

function requiresOpenSshLiveSessionUpdate(patch: SshLiveSessionPatch): boolean {
	return patch.status !== undefined;
}

function ticketTargetToDb(target?: string): Record<string, unknown> {
	return target ? { value: target } : {};
}

function ticketTargetFromDb(target: Record<string, unknown>): string {
	return typeof target.value === 'string' ? target.value : JSON.stringify(target);
}

export const termixRepository = new DrizzleTermixServicesRepository();
