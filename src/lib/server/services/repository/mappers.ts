import * as schema from '../../db/schema';
import {
	connectionSessions,
	credentials,
	hostShareInvitations,
	hosts,
	sessionTickets,
	sshTunnelProfiles,
	sshTunnelSessions,
	workspaceLayouts,
	workspaces,
	workspaceMemberships,
	type credentials as credentialsTable,
	type hostShareInvitations as hostShareInvitationsTable,
	type hosts as hostsTable,
	type sessionTickets as sessionTicketsTable,
	type sshTunnelProfiles as sshTunnelProfilesTable,
	type sshTunnelSessions as sshTunnelSessionsTable,
	type users as usersTable,
	type workspaceLayouts as workspaceLayoutsTable,
	type workspaces as workspacesTable,
	type workspaceMemberships as workspaceMembershipsTable
} from '../../db/schema';
import type {
	ConnectionHistoryFilters,
	ConnectionHistoryRecord,
	ConnectionSessionPatch,
	ConnectionSessionRecord,
	CredentialRecord,
	HostShareInvitationRecord,
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
	WorkspaceLayoutFilters,
	WorkspaceLayoutPatch,
	WorkspaceLayoutRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from '../types';

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
export type HostRow = typeof hostsTable.$inferSelect;
export type CredentialRow = typeof credentialsTable.$inferSelect;
export type HostShareInvitationRow = typeof hostShareInvitationsTable.$inferSelect;
export type SessionTicketRow = typeof sessionTicketsTable.$inferSelect;
export type WorkspaceRow = typeof workspacesTable.$inferSelect;
export type WorkspaceMembershipRow = typeof workspaceMembershipsTable.$inferSelect;
type UserRow = typeof usersTable.$inferSelect;
export type ConnectionSessionRow = typeof connectionSessions.$inferSelect;
export type SshTunnelProfileRow = typeof sshTunnelProfilesTable.$inferSelect;
export type SshTunnelSessionRow = typeof sshTunnelSessionsTable.$inferSelect;
export type WorkspaceLayoutRow = typeof workspaceLayoutsTable.$inferSelect;
export type SshLiveSessionRow = SshLiveSessionRecord;
export type SshAttachTicketRow = SshAttachTicketRecord;

const intendedSchema = schema as unknown as {
	sshLiveSessions?: IntendedSshLiveSessionsTable;
	sshAttachTickets?: IntendedSshAttachTicketsTable;
};

export function toHostRecord(row: HostRow): HostRecord {
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

export function toCredentialRecord(row: CredentialRow): CredentialRecord {
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

export function toHostShareInvitationRecord(
	row: HostShareInvitationRow
): HostShareInvitationRecord {
	return {
		id: row.id,
		senderUserId: row.senderUserId,
		recipientUserId: row.recipientUserId,
		hostId: row.hostId,
		credentialId: row.credentialId,
		includeCredentials: row.includeCredentials,
		status: row.status as HostShareInvitationRecord['status'],
		hostSnapshot: row.hostSnapshot as HostShareInvitationRecord['hostSnapshot'],
		credentialName: row.credentialName,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		respondedAt: row.respondedAt
	};
}

export function toSessionTicketRecord(row: SessionTicketRow): SessionTicketRecord {
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

export function toConnectionSessionRecord(row: ConnectionSessionRow): ConnectionSessionRecord {
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

export function toWorkspaceRecord(row: WorkspaceRow): WorkspaceRecord {
	return {
		id: row.id,
		name: row.name,
		metadata: row.metadata ?? {},
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

export function toWorkspaceMembershipRecord(
	row: WorkspaceMembershipRow
): WorkspaceMembershipRecord {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		userId: row.userId,
		role: row.role,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

export function toConnectionHistoryRecord(
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

export function toSshTunnelProfileRecord(row: SshTunnelProfileRow): SshTunnelProfileRecord {
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

export function toSshTunnelSessionRecord(row: SshTunnelSessionRow): SshTunnelSessionRecord {
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

export function toWorkspaceLayoutRecord(row: WorkspaceLayoutRow): WorkspaceLayoutRecord {
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

export function toSshLiveSessionRecord(row: SshLiveSessionRow): SshLiveSessionRecord {
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

export function toSshAttachTicketRecord(row: SshAttachTicketRow): SshAttachTicketRecord {
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

export function hostPatchToDb(patch: Partial<HostRecord>): Partial<typeof hosts.$inferInsert> {
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

export function credentialPatchToDb(
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

export function hostShareInvitationPatchToDb(
	patch: Partial<HostShareInvitationRecord>
): Partial<typeof hostShareInvitations.$inferInsert> {
	return {
		hostId: patch.hostId,
		credentialId: patch.credentialId,
		includeCredentials: patch.includeCredentials,
		status: patch.status,
		hostSnapshot: patch.hostSnapshot,
		credentialName: patch.credentialName,
		respondedAt: patch.respondedAt,
		updatedAt: patch.updatedAt
	};
}

export function connectionSessionPatchToDb(
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

export function workspaceMembershipPatchToDb(
	patch: Partial<WorkspaceMembershipRecord>
): Partial<typeof workspaceMemberships.$inferInsert> {
	return {
		role: patch.role,
		updatedAt: patch.updatedAt
	};
}

export function workspacePatchToDb(
	patch: Partial<WorkspaceRecord>
): Partial<typeof workspaces.$inferInsert> {
	return {
		name: patch.name,
		metadata: patch.metadata,
		updatedAt: patch.updatedAt
	};
}

export function sshTunnelProfilePatchToDb(
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

export function sshTunnelSessionPatchToDb(
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

export function workspaceLayoutPatchToDb(
	patch: WorkspaceLayoutPatch
): Partial<typeof workspaceLayouts.$inferInsert> {
	return {
		workspaceId: patch.workspaceId,
		layoutKind: patch.layoutKind,
		panes: patch.panes,
		updatedAt: patch.updatedAt
	};
}

export function matchesConnectionHistoryFilters(
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

export function matchesSshTunnelProfileFilters(
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

export function matchesSshTunnelSessionFilters(
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

export function matchesWorkspaceLayoutFilters(
	layout: WorkspaceLayoutRecord | WorkspaceLayoutRow,
	filters: WorkspaceLayoutFilters
): boolean {
	if (filters.workspaceId !== undefined && layout.workspaceId !== filters.workspaceId) {
		return false;
	}
	if (filters.layoutKind && layout.layoutKind !== filters.layoutKind) return false;
	return true;
}

export function workspaceMembershipKey(workspaceId: string, userId: string): string {
	return `${workspaceId}:${userId}`;
}

export function toSshLiveSessionInsert(session: SshLiveSessionRecord): Record<string, unknown> {
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

export function sshLiveSessionPatchToDb(patch: SshLiveSessionPatch): Record<string, unknown> {
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

export function getSshLiveSchema(): {
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

export function isOpenSshLiveSessionStatus(status: SshLiveSessionRecord['status']): boolean {
	return status === 'starting' || status === 'attached' || status === 'detached';
}

export function allowedCurrentSshLiveStatusesForUpdate(
	patch: SshLiveSessionPatch
): SshLiveSessionRecord['status'][] | null {
	if (patch.status === undefined) return null;
	if (patch.status === 'ended') return ['starting', 'attached', 'detached', 'stale'];
	return ['starting', 'attached', 'detached'];
}

export function ticketTargetToDb(target?: string): Record<string, unknown> {
	return target ? { value: target } : {};
}

export function ticketTargetFromDb(target: Record<string, unknown>): string {
	return typeof target.value === 'string' ? target.value : JSON.stringify(target);
}
