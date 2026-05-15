import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, type TermixDb } from '../db';
import * as schema from '../db/schema';
import {
	connectionSessions,
	credentials,
	hosts,
	sessionTickets,
	sshTunnelProfiles,
	sshTunnelSessions,
	users,
	workspaceLayouts,
	workspaces,
	workspaceMemberships,
	type credentials as credentialsTable,
	type hosts as hostsTable,
	type sessionTickets as sessionTicketsTable,
	type sshTunnelProfiles as sshTunnelProfilesTable,
	type sshTunnelSessions as sshTunnelSessionsTable,
	type users as usersTable,
	type workspaceLayouts as workspaceLayoutsTable,
	type workspaces as workspacesTable,
	type workspaceMemberships as workspaceMembershipsTable
} from '../db/schema';
import type {
	ConnectionHistoryFilters,
	ConnectionHistoryRecord,
	ConnectionSessionPatch,
	ConnectionSessionRecord,
	CredentialRecord,
	HostRecord,
	SshAttachTicketRecord,
	SshLiveSessionPatch,
	SshLiveSessionRecord,
	SshTunnelProfileFilters,
	SshTunnelProfilePatch,
	SshTunnelProfileRecord,
	SshTunnelSessionFilters,
	SshTunnelSessionPatch,
	SshTunnelSessionRecord,
	SessionTicketRecord,
	TermixServicesRepository,
	WorkspaceLayoutFilters,
	WorkspaceLayoutPatch,
	WorkspaceLayoutRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
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
type UserRow = typeof usersTable.$inferSelect;
type WorkspaceRow = typeof workspacesTable.$inferSelect;
type WorkspaceMembershipRow = typeof workspaceMembershipsTable.$inferSelect;
type ConnectionSessionRow = typeof connectionSessions.$inferSelect;
type SshTunnelProfileRow = typeof sshTunnelProfilesTable.$inferSelect;
type SshTunnelSessionRow = typeof sshTunnelSessionsTable.$inferSelect;
type WorkspaceLayoutRow = typeof workspaceLayoutsTable.$inferSelect;
type SshLiveSessionRow = SshLiveSessionRecord;
type SshAttachTicketRow = SshAttachTicketRecord;

const intendedSchema = schema as unknown as {
	sshLiveSessions?: IntendedSshLiveSessionsTable;
	sshAttachTickets?: IntendedSshAttachTicketsTable;
};

export class DrizzleTermixServicesRepository implements TermixServicesRepository {
	constructor(private readonly database: TermixDb = db) {}

	async listWorkspaces(userId: string): Promise<WorkspaceRecord[]> {
		const memberships = await this.listUserWorkspaceMemberships(userId);
		if (memberships.length === 0) return [];

		const rows = await this.database
			.select()
			.from(workspaces)
			.where(
				inArray(
					workspaces.id,
					memberships.map((membership) => membership.workspaceId)
				)
			);

		return rows.map(toWorkspaceRecord);
	}

	async getWorkspace(userId: string, id: string): Promise<WorkspaceRecord | null> {
		const membership = await this.getWorkspaceMembership(id, userId);
		if (!membership) return null;
		return this.getWorkspaceById(id);
	}

	async getWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
		const [row] = await this.database
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, id))
			.limit(1);

		return row ? toWorkspaceRecord(row) : null;
	}

	async createWorkspace(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
		const [row] = await this.database
			.insert(workspaces)
			.values({
				id: workspace.id,
				name: workspace.name,
				metadata: workspace.metadata,
				createdAt: workspace.createdAt,
				updatedAt: workspace.updatedAt
			})
			.returning();

		if (!row) throw new Error('Could not create workspace');
		return toWorkspaceRecord(row);
	}

	async updateWorkspace(
		id: string,
		patch: Partial<WorkspaceRecord>
	): Promise<WorkspaceRecord | null> {
		const [row] = await this.database
			.update(workspaces)
			.set(workspacePatchToDb(patch))
			.where(eq(workspaces.id, id))
			.returning();

		return row ? toWorkspaceRecord(row) : null;
	}

	async createWorkspaceMembership(
		membership: WorkspaceMembershipRecord
	): Promise<WorkspaceMembershipRecord> {
		const [row] = await this.database
			.insert(workspaceMemberships)
			.values({
				id: membership.id,
				workspaceId: membership.workspaceId,
				userId: membership.userId,
				role: membership.role,
				createdAt: membership.createdAt,
				updatedAt: membership.updatedAt
			})
			.returning();

		if (!row) throw new Error('Could not create workspace membership');
		return toWorkspaceMembershipRecord(row);
	}

	async listWorkspaceMemberships(workspaceId: string): Promise<WorkspaceMembershipRecord[]> {
		const rows = await this.database
			.select()
			.from(workspaceMemberships)
			.where(eq(workspaceMemberships.workspaceId, workspaceId));

		return rows.map(toWorkspaceMembershipRecord);
	}

	async listUserWorkspaceMemberships(userId: string): Promise<WorkspaceMembershipRecord[]> {
		const rows = await this.database
			.select()
			.from(workspaceMemberships)
			.where(eq(workspaceMemberships.userId, userId));

		return rows.map(toWorkspaceMembershipRecord);
	}

	async getWorkspaceMembership(
		workspaceId: string,
		userId: string
	): Promise<WorkspaceMembershipRecord | null> {
		const [row] = await this.database
			.select()
			.from(workspaceMemberships)
			.where(
				and(
					eq(workspaceMemberships.workspaceId, workspaceId),
					eq(workspaceMemberships.userId, userId)
				)
			)
			.limit(1);

		return row ? toWorkspaceMembershipRecord(row) : null;
	}

	async updateWorkspaceMembership(
		workspaceId: string,
		userId: string,
		patch: Partial<WorkspaceMembershipRecord>
	): Promise<WorkspaceMembershipRecord | null> {
		const [row] = await this.database
			.update(workspaceMemberships)
			.set(workspaceMembershipPatchToDb(patch))
			.where(
				and(
					eq(workspaceMemberships.workspaceId, workspaceId),
					eq(workspaceMemberships.userId, userId)
				)
			)
			.returning();

		return row ? toWorkspaceMembershipRecord(row) : null;
	}

	async deleteWorkspaceMembership(workspaceId: string, userId: string): Promise<boolean> {
		const rows = await this.database
			.delete(workspaceMemberships)
			.where(
				and(
					eq(workspaceMemberships.workspaceId, workspaceId),
					eq(workspaceMemberships.userId, userId)
				)
			)
			.returning({ id: workspaceMemberships.id });

		return rows.length > 0;
	}

	async listHosts(userId: string): Promise<HostRecord[]> {
		const workspaceIds = await this.getAccessibleWorkspaceIds(userId);
		const scopeFilter =
			workspaceIds.length > 0
				? or(
						and(eq(hosts.userId, userId), isNull(hosts.workspaceId)),
						inArray(hosts.workspaceId, workspaceIds)
					)
				: and(eq(hosts.userId, userId), isNull(hosts.workspaceId));
		const rows = await this.database.select().from(hosts).where(scopeFilter);
		return rows.map(toHostRecord);
	}

	async getHost(userId: string, id: string): Promise<HostRecord | null> {
		const workspaceIds = await this.getAccessibleWorkspaceIds(userId);
		const scopeFilter =
			workspaceIds.length > 0
				? or(
						and(eq(hosts.userId, userId), isNull(hosts.workspaceId)),
						inArray(hosts.workspaceId, workspaceIds)
					)
				: and(eq(hosts.userId, userId), isNull(hosts.workspaceId));
		const [row] = await this.database
			.select()
			.from(hosts)
			.where(and(eq(hosts.id, id), scopeFilter))
			.limit(1);

		return row ? toHostRecord(row) : null;
	}

	async createHost(host: HostRecord): Promise<HostRecord> {
		const [row] = await this.database
			.insert(hosts)
			.values({
				id: host.id,
				userId: host.userId,
				workspaceId: host.workspaceId,
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
		const existing = await this.getHost(userId, id);
		if (!existing) return null;
		const [row] = await this.database
			.update(hosts)
			.set(hostPatchToDb(patch))
			.where(eq(hosts.id, id))
			.returning();

		return row ? toHostRecord(row) : null;
	}

	async deleteHost(userId: string, id: string): Promise<boolean> {
		const existing = await this.getHost(userId, id);
		if (!existing) return false;
		const rows = await this.database
			.delete(hosts)
			.where(eq(hosts.id, id))
			.returning({ id: hosts.id });

		return rows.length > 0;
	}

	async listCredentials(userId: string): Promise<CredentialRecord[]> {
		const workspaceIds = await this.getAccessibleWorkspaceIds(userId);
		const scopeFilter =
			workspaceIds.length > 0
				? or(
						and(eq(credentials.userId, userId), isNull(credentials.workspaceId)),
						inArray(credentials.workspaceId, workspaceIds)
					)
				: and(eq(credentials.userId, userId), isNull(credentials.workspaceId));
		const rows = await this.database.select().from(credentials).where(scopeFilter);

		return rows.map(toCredentialRecord);
	}

	async getCredential(userId: string, id: string): Promise<CredentialRecord | null> {
		const workspaceIds = await this.getAccessibleWorkspaceIds(userId);
		const scopeFilter =
			workspaceIds.length > 0
				? or(
						and(eq(credentials.userId, userId), isNull(credentials.workspaceId)),
						inArray(credentials.workspaceId, workspaceIds)
					)
				: and(eq(credentials.userId, userId), isNull(credentials.workspaceId));
		const [row] = await this.database
			.select()
			.from(credentials)
			.where(and(eq(credentials.id, id), scopeFilter))
			.limit(1);

		return row ? toCredentialRecord(row) : null;
	}

	async createCredential(credential: CredentialRecord): Promise<CredentialRecord> {
		const [row] = await this.database
			.insert(credentials)
			.values({
				id: credential.id,
				userId: credential.userId,
				workspaceId: credential.workspaceId,
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
		const existing = await this.getCredential(userId, id);
		if (!existing) return null;
		const [row] = await this.database
			.update(credentials)
			.set(credentialPatchToDb(patch))
			.where(eq(credentials.id, id))
			.returning();

		return row ? toCredentialRecord(row) : null;
	}

	async deleteCredential(userId: string, id: string): Promise<boolean> {
		const existing = await this.getCredential(userId, id);
		if (!existing) return false;
		const rows = await this.database
			.delete(credentials)
			.where(eq(credentials.id, id))
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
				workspaceId: session.workspaceId,
				hostId: session.hostId,
				protocol: session.protocol,
				status: session.status,
				startedAt: session.startedAt,
				endedAt: session.endedAt,
				errorCode: session.errorCode,
				errorMessage: session.errorMessage ?? null,
				errorDetails: session.errorDetails ?? null,
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

	async listConnectionHistory(
		userId: string,
		filters: ConnectionHistoryFilters = {}
	): Promise<ConnectionHistoryRecord[]> {
		const workspaceIds = await this.getAccessibleWorkspaceIds(userId);
		const scopeFilter =
			workspaceIds.length > 0
				? or(
						and(eq(connectionSessions.userId, userId), isNull(connectionSessions.workspaceId)),
						inArray(connectionSessions.workspaceId, workspaceIds)
					)
				: and(eq(connectionSessions.userId, userId), isNull(connectionSessions.workspaceId));
		const rows = await this.database.select().from(connectionSessions).where(scopeFilter);
		const filteredRows = rows.filter((row) => matchesConnectionHistoryFilters(row, filters));
		const hostMap = await this.getHostMap(
			filteredRows.flatMap((row) => (row.hostId ? [row.hostId] : []))
		);
		const workspaceMap = await this.getWorkspaceMap(
			filteredRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))
		);
		const userMap = await this.getUserMap(filteredRows.map((row) => row.userId));

		return filteredRows
			.map((row) =>
				toConnectionHistoryRecord(
					row,
					row.hostId ? (hostMap.get(row.hostId) ?? null) : null,
					row.workspaceId ? (workspaceMap.get(row.workspaceId) ?? null) : null,
					userMap.get(row.userId) ?? null
				)
			)
			.sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
	}

	async listSshTunnelProfiles(
		userId: string,
		filters: SshTunnelProfileFilters = {}
	): Promise<SshTunnelProfileRecord[]> {
		const workspaceIds = await this.getAccessibleWorkspaceIds(userId);
		const scopeFilter =
			workspaceIds.length > 0
				? or(
						and(eq(sshTunnelProfiles.userId, userId), isNull(sshTunnelProfiles.workspaceId)),
						inArray(sshTunnelProfiles.workspaceId, workspaceIds)
					)
				: and(eq(sshTunnelProfiles.userId, userId), isNull(sshTunnelProfiles.workspaceId));
		const rows = await this.database.select().from(sshTunnelProfiles).where(scopeFilter);

		return rows
			.filter((row) => matchesSshTunnelProfileFilters(row, filters))
			.map(toSshTunnelProfileRecord);
	}

	async getSshTunnelProfile(userId: string, id: string): Promise<SshTunnelProfileRecord | null> {
		const profiles = await this.listSshTunnelProfiles(userId);
		return profiles.find((profile) => profile.id === id) ?? null;
	}

	async createSshTunnelProfile(profile: SshTunnelProfileRecord): Promise<SshTunnelProfileRecord> {
		const [row] = await this.database
			.insert(sshTunnelProfiles)
			.values({
				id: profile.id,
				userId: profile.userId,
				workspaceId: profile.workspaceId,
				sshHostId: profile.sshHostId,
				name: profile.name,
				targetHost: profile.targetHost,
				targetPort: profile.targetPort,
				description: profile.description,
				createdAt: profile.createdAt,
				updatedAt: profile.updatedAt
			})
			.returning();

		if (!row) throw new Error('Could not create SSH tunnel profile');
		return toSshTunnelProfileRecord(row);
	}

	async updateSshTunnelProfile(
		userId: string,
		id: string,
		patch: SshTunnelProfilePatch
	): Promise<SshTunnelProfileRecord | null> {
		const existing = await this.getSshTunnelProfile(userId, id);
		if (!existing) return null;
		const [row] = await this.database
			.update(sshTunnelProfiles)
			.set(sshTunnelProfilePatchToDb(patch))
			.where(eq(sshTunnelProfiles.id, id))
			.returning();

		return row ? toSshTunnelProfileRecord(row) : null;
	}

	async deleteSshTunnelProfile(userId: string, id: string): Promise<boolean> {
		const existing = await this.getSshTunnelProfile(userId, id);
		if (!existing) return false;
		const rows = await this.database
			.delete(sshTunnelProfiles)
			.where(eq(sshTunnelProfiles.id, id))
			.returning({ id: sshTunnelProfiles.id });

		return rows.length > 0;
	}

	async listSshTunnelSessions(
		userId: string,
		filters: SshTunnelSessionFilters = {}
	): Promise<SshTunnelSessionRecord[]> {
		const workspaceIds = await this.getAccessibleWorkspaceIds(userId);
		const scopeFilter =
			workspaceIds.length > 0
				? or(
						and(eq(sshTunnelSessions.userId, userId), isNull(sshTunnelSessions.workspaceId)),
						inArray(sshTunnelSessions.workspaceId, workspaceIds)
					)
				: and(eq(sshTunnelSessions.userId, userId), isNull(sshTunnelSessions.workspaceId));
		const rows = await this.database.select().from(sshTunnelSessions).where(scopeFilter);

		return rows
			.filter((row) => matchesSshTunnelSessionFilters(row, filters))
			.map(toSshTunnelSessionRecord)
			.sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
	}

	async getSshTunnelSession(userId: string, id: string): Promise<SshTunnelSessionRecord | null> {
		const sessions = await this.listSshTunnelSessions(userId);
		return sessions.find((session) => session.id === id) ?? null;
	}

	async createSshTunnelSession(session: SshTunnelSessionRecord): Promise<SshTunnelSessionRecord> {
		const [row] = await this.database
			.insert(sshTunnelSessions)
			.values({
				id: session.id,
				profileId: session.profileId,
				userId: session.userId,
				workspaceId: session.workspaceId,
				sshHostId: session.sshHostId,
				targetHost: session.targetHost,
				targetPort: session.targetPort,
				publicPath: session.publicPath,
				status: session.status,
				startedAt: session.startedAt,
				endedAt: session.endedAt,
				lastSeenAt: session.lastSeenAt,
				errorCode: session.errorCode,
				errorMessage: session.errorMessage
			})
			.returning();

		if (!row) throw new Error('Could not create SSH tunnel session');
		return toSshTunnelSessionRecord(row);
	}

	async updateSshTunnelSession(
		userId: string,
		id: string,
		patch: SshTunnelSessionPatch
	): Promise<SshTunnelSessionRecord | null> {
		const existing = await this.getSshTunnelSession(userId, id);
		if (!existing) return null;
		const [row] = await this.database
			.update(sshTunnelSessions)
			.set(sshTunnelSessionPatchToDb(patch))
			.where(eq(sshTunnelSessions.id, id))
			.returning();

		return row ? toSshTunnelSessionRecord(row) : null;
	}

	async listWorkspaceLayouts(
		userId: string,
		filters: WorkspaceLayoutFilters = {}
	): Promise<WorkspaceLayoutRecord[]> {
		const rows = await this.database
			.select()
			.from(workspaceLayouts)
			.where(eq(workspaceLayouts.userId, userId));

		return rows
			.filter((row) => matchesWorkspaceLayoutFilters(row, filters))
			.map(toWorkspaceLayoutRecord);
	}

	async getWorkspaceLayout(userId: string, id: string): Promise<WorkspaceLayoutRecord | null> {
		const [row] = await this.database
			.select()
			.from(workspaceLayouts)
			.where(and(eq(workspaceLayouts.id, id), eq(workspaceLayouts.userId, userId)))
			.limit(1);

		return row ? toWorkspaceLayoutRecord(row) : null;
	}

	async createWorkspaceLayout(layout: WorkspaceLayoutRecord): Promise<WorkspaceLayoutRecord> {
		const [row] = await this.database
			.insert(workspaceLayouts)
			.values({
				id: layout.id,
				userId: layout.userId,
				workspaceId: layout.workspaceId,
				layoutKind: layout.layoutKind,
				panes: layout.panes,
				createdAt: layout.createdAt,
				updatedAt: layout.updatedAt
			})
			.returning();

		if (!row) throw new Error('Could not create workspace layout');
		return toWorkspaceLayoutRecord(row);
	}

	async updateWorkspaceLayout(
		userId: string,
		id: string,
		patch: WorkspaceLayoutPatch
	): Promise<WorkspaceLayoutRecord | null> {
		const [row] = await this.database
			.update(workspaceLayouts)
			.set(workspaceLayoutPatchToDb(patch))
			.where(and(eq(workspaceLayouts.id, id), eq(workspaceLayouts.userId, userId)))
			.returning();

		return row ? toWorkspaceLayoutRecord(row) : null;
	}

	async deleteWorkspaceLayout(userId: string, id: string): Promise<boolean> {
		const rows = await this.database
			.delete(workspaceLayouts)
			.where(and(eq(workspaceLayouts.id, id), eq(workspaceLayouts.userId, userId)))
			.returning({ id: workspaceLayouts.id });

		return rows.length > 0;
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
		const allowedCurrentStatuses = allowedCurrentSshLiveStatusesForUpdate(patch);
		const statusGuard = allowedCurrentStatuses
			? inArray(sshLiveSessions.status as typeof hosts.name, allowedCurrentStatuses)
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

	private async getAccessibleWorkspaceIds(userId: string): Promise<string[]> {
		const memberships = await this.listUserWorkspaceMemberships(userId);
		return memberships.map((membership) => membership.workspaceId);
	}

	private async getHostMap(hostIds: string[]): Promise<Map<string, HostRow>> {
		const uniqueIds = [...new Set(hostIds)];
		if (uniqueIds.length === 0) return new Map();
		const rows = await this.database.select().from(hosts).where(inArray(hosts.id, uniqueIds));
		return new Map(rows.map((row) => [row.id, row]));
	}

	private async getWorkspaceMap(workspaceIds: string[]): Promise<Map<string, WorkspaceRow>> {
		const uniqueIds = [...new Set(workspaceIds)];
		if (uniqueIds.length === 0) return new Map();
		const rows = await this.database
			.select()
			.from(workspaces)
			.where(inArray(workspaces.id, uniqueIds));
		return new Map(rows.map((row) => [row.id, row]));
	}

	private async getUserMap(userIds: string[]): Promise<Map<string, UserRow>> {
		const uniqueIds = [...new Set(userIds)];
		if (uniqueIds.length === 0) return new Map();
		const rows = await this.database.select().from(users).where(inArray(users.id, uniqueIds));
		return new Map(rows.map((row) => [row.id, row]));
	}
}

export class InMemoryTermixServicesRepository implements TermixServicesRepository {
	private readonly workspaces = new Map<string, WorkspaceRecord>();
	private readonly workspaceMemberships = new Map<string, WorkspaceMembershipRecord>();
	private readonly hosts = new Map<string, HostRecord>();
	private readonly credentials = new Map<string, CredentialRecord>();
	private readonly tickets = new Map<string, SessionTicketRecord>();
	private readonly connectionSessions = new Map<string, ConnectionSessionRecord>();
	private readonly sshTunnelProfiles = new Map<string, SshTunnelProfileRecord>();
	private readonly sshTunnelSessions = new Map<string, SshTunnelSessionRecord>();
	private readonly workspaceLayouts = new Map<string, WorkspaceLayoutRecord>();
	private readonly sshLiveSessions = new Map<string, SshLiveSessionRecord>();
	private readonly sshAttachTickets = new Map<string, SshAttachTicketRecord>();

	async listWorkspaces(userId: string): Promise<WorkspaceRecord[]> {
		const workspaceIds = await this.accessibleWorkspaceIds(userId);
		return workspaceIds
			.map((workspaceId) => this.workspaces.get(workspaceId))
			.filter((workspace): workspace is WorkspaceRecord => Boolean(workspace));
	}

	async getWorkspace(userId: string, id: string): Promise<WorkspaceRecord | null> {
		const membership = await this.getWorkspaceMembership(id, userId);
		return membership ? (this.workspaces.get(id) ?? null) : null;
	}

	async getWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
		return this.workspaces.get(id) ?? null;
	}

	async createWorkspace(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
		this.workspaces.set(workspace.id, workspace);
		return workspace;
	}

	async updateWorkspace(
		id: string,
		patch: Partial<WorkspaceRecord>
	): Promise<WorkspaceRecord | null> {
		const workspace = this.workspaces.get(id);
		if (!workspace) return null;
		const updated = { ...workspace, ...patch, id };
		this.workspaces.set(id, updated);
		return updated;
	}

	async createWorkspaceMembership(
		membership: WorkspaceMembershipRecord
	): Promise<WorkspaceMembershipRecord> {
		this.workspaceMemberships.set(
			workspaceMembershipKey(membership.workspaceId, membership.userId),
			membership
		);
		return membership;
	}

	async listWorkspaceMemberships(workspaceId: string): Promise<WorkspaceMembershipRecord[]> {
		return [...this.workspaceMemberships.values()].filter(
			(membership) => membership.workspaceId === workspaceId
		);
	}

	async listUserWorkspaceMemberships(userId: string): Promise<WorkspaceMembershipRecord[]> {
		return [...this.workspaceMemberships.values()].filter(
			(membership) => membership.userId === userId
		);
	}

	async getWorkspaceMembership(
		workspaceId: string,
		userId: string
	): Promise<WorkspaceMembershipRecord | null> {
		return this.workspaceMemberships.get(workspaceMembershipKey(workspaceId, userId)) ?? null;
	}

	async updateWorkspaceMembership(
		workspaceId: string,
		userId: string,
		patch: Partial<WorkspaceMembershipRecord>
	): Promise<WorkspaceMembershipRecord | null> {
		const membership = await this.getWorkspaceMembership(workspaceId, userId);
		if (!membership) return null;

		const updated = { ...membership, ...patch, workspaceId, userId };
		this.workspaceMemberships.set(workspaceMembershipKey(workspaceId, userId), updated);
		return updated;
	}

	async deleteWorkspaceMembership(workspaceId: string, userId: string): Promise<boolean> {
		return this.workspaceMemberships.delete(workspaceMembershipKey(workspaceId, userId));
	}

	async listHosts(userId: string): Promise<HostRecord[]> {
		const workspaceIds = await this.accessibleWorkspaceIds(userId);
		return [...this.hosts.values()].filter(
			(host) =>
				(host.userId === userId && host.workspaceId === null) ||
				(host.workspaceId !== null && workspaceIds.includes(host.workspaceId))
		);
	}

	async getHost(userId: string, id: string): Promise<HostRecord | null> {
		const host = this.hosts.get(id);
		if (!host) return null;
		if (host.userId === userId && host.workspaceId === null) return host;
		if (host.workspaceId && (await this.isWorkspaceMember(userId, host.workspaceId))) return host;
		return null;
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

		const updated = { ...host, ...patch, id, userId: host.userId };
		this.hosts.set(id, updated);
		return updated;
	}

	async deleteHost(userId: string, id: string): Promise<boolean> {
		const host = await this.getHost(userId, id);
		if (!host) return false;
		const deleted = this.hosts.delete(id);
		if (!deleted) return false;

		for (const session of this.connectionSessions.values()) {
			if (session.hostId === id) {
				this.connectionSessions.set(session.id, { ...session, hostId: null });
			}
		}
		for (const [profileId, profile] of this.sshTunnelProfiles.entries()) {
			if (profile.sshHostId === id) this.sshTunnelProfiles.delete(profileId);
		}
		for (const [ticketHash, ticket] of this.tickets.entries()) {
			if (ticket.hostId === id) this.tickets.delete(ticketHash);
		}
		const deletedSshLiveSessionIds = new Set<string>();
		for (const [sessionId, session] of this.sshLiveSessions.entries()) {
			if (session.hostId === id) {
				this.sshLiveSessions.delete(sessionId);
				deletedSshLiveSessionIds.add(sessionId);
			}
		}
		for (const [ticketHash, ticket] of this.sshAttachTickets.entries()) {
			if (deletedSshLiveSessionIds.has(ticket.sshLiveSessionId)) {
				this.sshAttachTickets.delete(ticketHash);
			}
		}
		for (const tunnelSession of this.sshTunnelSessions.values()) {
			if (tunnelSession.sshHostId === id) {
				this.sshTunnelSessions.set(tunnelSession.id, {
					...tunnelSession,
					profileId: null,
					sshHostId: null
				});
			}
		}

		return true;
	}

	async listCredentials(userId: string): Promise<CredentialRecord[]> {
		const workspaceIds = await this.accessibleWorkspaceIds(userId);
		return [...this.credentials.values()].filter(
			(credential) =>
				(credential.userId === userId && credential.workspaceId === null) ||
				(credential.workspaceId !== null && workspaceIds.includes(credential.workspaceId))
		);
	}

	async getCredential(userId: string, id: string): Promise<CredentialRecord | null> {
		const credential = this.credentials.get(id);
		if (!credential) return null;
		if (credential.userId === userId && credential.workspaceId === null) return credential;
		if (credential.workspaceId && (await this.isWorkspaceMember(userId, credential.workspaceId))) {
			return credential;
		}
		return null;
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

		const updated = { ...credential, ...patch, id, userId: credential.userId };
		this.credentials.set(id, updated);
		return updated;
	}

	async deleteCredential(userId: string, id: string): Promise<boolean> {
		const credential = await this.getCredential(userId, id);
		if (!credential) return false;
		const deleted = this.credentials.delete(id);
		if (!deleted) return false;
		for (const host of this.hosts.values()) {
			if (host.credentialId === id) {
				this.hosts.set(host.id, { ...host, credentialId: null });
			}
		}
		return true;
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

	async listConnectionHistory(
		userId: string,
		filters: ConnectionHistoryFilters = {}
	): Promise<ConnectionHistoryRecord[]> {
		const workspaceIds = await this.accessibleWorkspaceIds(userId);
		return [...this.connectionSessions.values()]
			.filter(
				(session) =>
					(session.userId === userId && session.workspaceId === null) ||
					(session.workspaceId !== null && workspaceIds.includes(session.workspaceId))
			)
			.filter((session) => matchesConnectionHistoryFilters(session, filters))
			.map((session) =>
				toConnectionHistoryRecord(
					session,
					session.hostId ? (this.hosts.get(session.hostId) ?? null) : null,
					session.workspaceId ? (this.workspaces.get(session.workspaceId) ?? null) : null,
					null
				)
			)
			.sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
	}

	async listSshTunnelProfiles(
		userId: string,
		filters: SshTunnelProfileFilters = {}
	): Promise<SshTunnelProfileRecord[]> {
		const workspaceIds = await this.accessibleWorkspaceIds(userId);
		return [...this.sshTunnelProfiles.values()]
			.filter(
				(profile) =>
					(profile.userId === userId && profile.workspaceId === null) ||
					(profile.workspaceId !== null && workspaceIds.includes(profile.workspaceId))
			)
			.filter((profile) => matchesSshTunnelProfileFilters(profile, filters));
	}

	async getSshTunnelProfile(userId: string, id: string): Promise<SshTunnelProfileRecord | null> {
		const profile = this.sshTunnelProfiles.get(id);
		if (!profile) return null;
		if (profile.userId === userId && profile.workspaceId === null) return profile;
		if (profile.workspaceId && (await this.isWorkspaceMember(userId, profile.workspaceId))) {
			return profile;
		}
		return null;
	}

	async createSshTunnelProfile(profile: SshTunnelProfileRecord): Promise<SshTunnelProfileRecord> {
		this.sshTunnelProfiles.set(profile.id, profile);
		return profile;
	}

	async updateSshTunnelProfile(
		userId: string,
		id: string,
		patch: SshTunnelProfilePatch
	): Promise<SshTunnelProfileRecord | null> {
		const profile = await this.getSshTunnelProfile(userId, id);
		if (!profile) return null;

		const updated = { ...profile, ...patch, id };
		this.sshTunnelProfiles.set(id, updated);
		return updated;
	}

	async deleteSshTunnelProfile(userId: string, id: string): Promise<boolean> {
		const profile = await this.getSshTunnelProfile(userId, id);
		if (!profile) return false;
		const deleted = this.sshTunnelProfiles.delete(id);
		if (!deleted) return false;
		for (const session of this.sshTunnelSessions.values()) {
			if (session.profileId === id) {
				this.sshTunnelSessions.set(session.id, { ...session, profileId: null });
			}
		}
		return true;
	}

	async listSshTunnelSessions(
		userId: string,
		filters: SshTunnelSessionFilters = {}
	): Promise<SshTunnelSessionRecord[]> {
		const workspaceIds = await this.accessibleWorkspaceIds(userId);
		return [...this.sshTunnelSessions.values()]
			.filter(
				(session) =>
					(session.userId === userId && session.workspaceId === null) ||
					(session.workspaceId !== null && workspaceIds.includes(session.workspaceId))
			)
			.filter((session) => matchesSshTunnelSessionFilters(session, filters))
			.sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
	}

	async getSshTunnelSession(userId: string, id: string): Promise<SshTunnelSessionRecord | null> {
		const session = this.sshTunnelSessions.get(id);
		if (!session) return null;
		if (session.userId === userId && session.workspaceId === null) return session;
		if (session.workspaceId && (await this.isWorkspaceMember(userId, session.workspaceId))) {
			return session;
		}
		return null;
	}

	async createSshTunnelSession(session: SshTunnelSessionRecord): Promise<SshTunnelSessionRecord> {
		this.sshTunnelSessions.set(session.id, session);
		return session;
	}

	async updateSshTunnelSession(
		userId: string,
		id: string,
		patch: SshTunnelSessionPatch
	): Promise<SshTunnelSessionRecord | null> {
		const session = await this.getSshTunnelSession(userId, id);
		if (!session) return null;

		const updated = { ...session, ...patch, id };
		this.sshTunnelSessions.set(id, updated);
		return updated;
	}

	async listWorkspaceLayouts(
		userId: string,
		filters: WorkspaceLayoutFilters = {}
	): Promise<WorkspaceLayoutRecord[]> {
		return [...this.workspaceLayouts.values()]
			.filter((layout) => layout.userId === userId)
			.filter((layout) => matchesWorkspaceLayoutFilters(layout, filters));
	}

	async getWorkspaceLayout(userId: string, id: string): Promise<WorkspaceLayoutRecord | null> {
		const layout = this.workspaceLayouts.get(id);
		return layout?.userId === userId ? layout : null;
	}

	async createWorkspaceLayout(layout: WorkspaceLayoutRecord): Promise<WorkspaceLayoutRecord> {
		this.workspaceLayouts.set(layout.id, layout);
		return layout;
	}

	async updateWorkspaceLayout(
		userId: string,
		id: string,
		patch: WorkspaceLayoutPatch
	): Promise<WorkspaceLayoutRecord | null> {
		const layout = await this.getWorkspaceLayout(userId, id);
		if (!layout) return null;

		const updated = { ...layout, ...patch, id, userId };
		this.workspaceLayouts.set(id, updated);
		return updated;
	}

	async deleteWorkspaceLayout(userId: string, id: string): Promise<boolean> {
		const layout = await this.getWorkspaceLayout(userId, id);
		if (!layout) return false;
		return this.workspaceLayouts.delete(id);
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
		const allowedCurrentStatuses = allowedCurrentSshLiveStatusesForUpdate(patch);
		if (allowedCurrentStatuses && !allowedCurrentStatuses.includes(session.status)) {
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

	private async accessibleWorkspaceIds(userId: string): Promise<string[]> {
		return (await this.listUserWorkspaceMemberships(userId)).map(
			(membership) => membership.workspaceId
		);
	}

	private async isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
		return Boolean(await this.getWorkspaceMembership(workspaceId, userId));
	}
}

function toHostRecord(row: HostRow): HostRecord {
	return {
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
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
		workspaceId: row.workspaceId,
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
		workspaceId: row.workspaceId,
		hostId: row.hostId,
		protocol: row.protocol,
		status: row.status,
		startedAt: row.startedAt,
		endedAt: row.endedAt,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
		errorDetails: row.errorDetails,
		updatedAt: row.updatedAt
	};
}

function toWorkspaceRecord(row: WorkspaceRow): WorkspaceRecord {
	return {
		id: row.id,
		name: row.name,
		metadata: row.metadata ?? {},
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toWorkspaceMembershipRecord(row: WorkspaceMembershipRow): WorkspaceMembershipRecord {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		userId: row.userId,
		role: row.role,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toConnectionHistoryRecord(
	session: ConnectionSessionRecord | ConnectionSessionRow,
	host: HostRecord | HostRow | null,
	workspace: WorkspaceRecord | WorkspaceRow | null,
	user: Pick<UserRow, 'username'> | null
): ConnectionHistoryRecord {
	return {
		id: session.id,
		userId: session.userId,
		username: user?.username ?? null,
		workspaceId: session.workspaceId,
		workspaceName: workspace?.name ?? null,
		hostId: session.hostId,
		hostName: host?.name ?? null,
		hostname: host?.hostname ?? null,
		hostUsername: host?.username ?? null,
		protocol: session.protocol,
		startedAt: session.startedAt,
		endedAt: session.endedAt,
		durationMs: session.endedAt ? session.endedAt.getTime() - session.startedAt.getTime() : null,
		status: session.status,
		errorReason: session.errorMessage ?? session.errorCode,
		errorCode: session.errorCode,
		errorMessage: session.errorMessage ?? null,
		errorDetails: session.errorDetails ?? null
	};
}

function toSshTunnelProfileRecord(row: SshTunnelProfileRow): SshTunnelProfileRecord {
	return {
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
		sshHostId: row.sshHostId,
		name: row.name,
		targetHost: row.targetHost,
		targetPort: row.targetPort,
		description: row.description,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toSshTunnelSessionRecord(row: SshTunnelSessionRow): SshTunnelSessionRecord {
	return {
		id: row.id,
		profileId: row.profileId,
		userId: row.userId,
		workspaceId: row.workspaceId,
		sshHostId: row.sshHostId,
		targetHost: row.targetHost,
		targetPort: row.targetPort,
		publicPath: row.publicPath,
		status: row.status,
		startedAt: row.startedAt,
		endedAt: row.endedAt,
		lastSeenAt: row.lastSeenAt,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage
	};
}

function toWorkspaceLayoutRecord(row: WorkspaceLayoutRow): WorkspaceLayoutRecord {
	return {
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
		layoutKind: row.layoutKind,
		panes: row.panes,
		createdAt: row.createdAt,
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
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
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
		workspaceId: patch.workspaceId,
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
		workspaceId: patch.workspaceId,
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
		errorMessage: patch.errorMessage,
		errorDetails: patch.errorDetails,
		updatedAt: patch.updatedAt
	};
}

function workspaceMembershipPatchToDb(
	patch: Partial<WorkspaceMembershipRecord>
): Partial<typeof workspaceMemberships.$inferInsert> {
	return {
		role: patch.role,
		updatedAt: patch.updatedAt
	};
}

function workspacePatchToDb(
	patch: Partial<WorkspaceRecord>
): Partial<typeof workspaces.$inferInsert> {
	return {
		name: patch.name,
		metadata: patch.metadata,
		updatedAt: patch.updatedAt
	};
}

function sshTunnelProfilePatchToDb(
	patch: SshTunnelProfilePatch
): Partial<typeof sshTunnelProfiles.$inferInsert> {
	return {
		workspaceId: patch.workspaceId,
		sshHostId: patch.sshHostId,
		name: patch.name,
		targetHost: patch.targetHost,
		targetPort: patch.targetPort,
		description: patch.description,
		updatedAt: patch.updatedAt
	};
}

function sshTunnelSessionPatchToDb(
	patch: SshTunnelSessionPatch
): Partial<typeof sshTunnelSessions.$inferInsert> {
	return {
		profileId: patch.profileId,
		workspaceId: patch.workspaceId,
		sshHostId: patch.sshHostId,
		targetHost: patch.targetHost,
		targetPort: patch.targetPort,
		publicPath: patch.publicPath,
		status: patch.status,
		endedAt: patch.endedAt,
		lastSeenAt: patch.lastSeenAt,
		errorCode: patch.errorCode,
		errorMessage: patch.errorMessage
	};
}

function workspaceLayoutPatchToDb(
	patch: WorkspaceLayoutPatch
): Partial<typeof workspaceLayouts.$inferInsert> {
	return {
		workspaceId: patch.workspaceId,
		layoutKind: patch.layoutKind,
		panes: patch.panes,
		updatedAt: patch.updatedAt
	};
}

function matchesConnectionHistoryFilters(
	session: ConnectionSessionRecord | ConnectionSessionRow,
	filters: ConnectionHistoryFilters
): boolean {
	if (filters.workspaceId !== undefined && session.workspaceId !== filters.workspaceId)
		return false;
	if (filters.hostId !== undefined && session.hostId !== filters.hostId) return false;
	if (filters.userId !== undefined && session.userId !== filters.userId) return false;
	if (filters.protocol && session.protocol !== filters.protocol) return false;
	if (filters.status && session.status !== filters.status) return false;
	if (filters.startedAfter && session.startedAt < filters.startedAfter) return false;
	if (filters.startedBefore && session.startedAt > filters.startedBefore) return false;
	return true;
}

function matchesSshTunnelProfileFilters(
	profile: SshTunnelProfileRecord | SshTunnelProfileRow,
	filters: SshTunnelProfileFilters
): boolean {
	if (filters.workspaceId !== undefined && profile.workspaceId !== filters.workspaceId) {
		return false;
	}
	if (filters.sshHostId !== undefined && profile.sshHostId !== filters.sshHostId) return false;
	if (filters.userId !== undefined && profile.userId !== filters.userId) return false;
	return true;
}

function matchesSshTunnelSessionFilters(
	session: SshTunnelSessionRecord | SshTunnelSessionRow,
	filters: SshTunnelSessionFilters
): boolean {
	if (filters.workspaceId !== undefined && session.workspaceId !== filters.workspaceId) {
		return false;
	}
	if (filters.sshHostId !== undefined && session.sshHostId !== filters.sshHostId) return false;
	if (filters.profileId !== undefined && session.profileId !== filters.profileId) return false;
	if (filters.userId !== undefined && session.userId !== filters.userId) return false;
	if (filters.status && session.status !== filters.status) return false;
	return true;
}

function matchesWorkspaceLayoutFilters(
	layout: WorkspaceLayoutRecord | WorkspaceLayoutRow,
	filters: WorkspaceLayoutFilters
): boolean {
	if (filters.workspaceId !== undefined && layout.workspaceId !== filters.workspaceId) {
		return false;
	}
	if (filters.layoutKind && layout.layoutKind !== filters.layoutKind) return false;
	return true;
}

function workspaceMembershipKey(workspaceId: string, userId: string): string {
	return `${workspaceId}:${userId}`;
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
		errorCode: session.errorCode,
		errorMessage: session.errorMessage,
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
		errorCode: patch.errorCode,
		errorMessage: patch.errorMessage,
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

function allowedCurrentSshLiveStatusesForUpdate(
	patch: SshLiveSessionPatch
): SshLiveSessionRecord['status'][] | null {
	if (patch.status === undefined) return null;
	if (patch.status === 'ended') return ['starting', 'attached', 'detached', 'stale'];
	return ['starting', 'attached', 'detached'];
}

function ticketTargetToDb(target?: string): Record<string, unknown> {
	return target ? { value: target } : {};
}

function ticketTargetFromDb(target: Record<string, unknown>): string {
	return typeof target.value === 'string' ? target.value : JSON.stringify(target);
}

export const termixRepository = new DrizzleTermixServicesRepository();
