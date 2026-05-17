import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, type TermixDb } from '../../db';
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
	type users as usersTable
} from '../../db/schema';
import type {
	ConnectionHistoryFilters,
	ConnectionHistoryRecord,
	ConnectionSessionPatch,
	ConnectionSessionRecord,
	CredentialRecord,
	HostRecord,
	SessionTicketRecord,
	SshAttachTicketRecord,
	SshLiveSessionPatch,
	SshLiveSessionRecord,
	SshTunnelProfileFilters,
	SshTunnelProfilePatch,
	SshTunnelProfileRecord,
	SshTunnelSessionFilters,
	SshTunnelSessionPatch,
	SshTunnelSessionRecord,
	TermixServicesRepository,
	WorkspaceLayoutFilters,
	WorkspaceLayoutPatch,
	WorkspaceLayoutRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from '../types';
import {
	allowedCurrentSshLiveStatusesForUpdate,
	connectionSessionPatchToDb,
	credentialPatchToDb,
	getSshLiveSchema,
	hostPatchToDb,
	isOpenSshLiveSessionStatus,
	matchesConnectionHistoryFilters,
	matchesSshTunnelProfileFilters,
	matchesSshTunnelSessionFilters,
	matchesWorkspaceLayoutFilters,
	sshLiveSessionPatchToDb,
	sshTunnelProfilePatchToDb,
	sshTunnelSessionPatchToDb,
	ticketTargetToDb,
	toConnectionHistoryRecord,
	toConnectionSessionRecord,
	toCredentialRecord,
	toHostRecord,
	toSessionTicketRecord,
	toSshAttachTicketRecord,
	toSshLiveSessionInsert,
	toSshLiveSessionRecord,
	toSshTunnelProfileRecord,
	toSshTunnelSessionRecord,
	toWorkspaceLayoutRecord,
	toWorkspaceMembershipRecord,
	toWorkspaceRecord,
	workspaceLayoutPatchToDb,
	workspaceMembershipPatchToDb,
	workspacePatchToDb,
	type HostRow,
	type SshAttachTicketRow,
	type SshLiveSessionRow,
	type WorkspaceRow
} from './mappers';

type UserRow = typeof usersTable.$inferSelect;
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
