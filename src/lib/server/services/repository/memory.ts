import type {
	ConnectionHistoryFilters,
	ConnectionHistoryRecord,
	ConnectionSessionPatch,
	ConnectionSessionRecord,
	CredentialRecord,
	HostShareInvitationRecord,
	HostRecord,
	RdpLiveSessionPatch,
	RdpLiveSessionRecord,
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
	UserRecord,
	WorkspaceLayoutFilters,
	WorkspaceLayoutPatch,
	WorkspaceLayoutRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from '../types';
import {
	allowedCurrentSshLiveStatusesForUpdate,
	isOpenSshLiveSessionStatus,
	matchesConnectionHistoryFilters,
	matchesSshTunnelProfileFilters,
	matchesSshTunnelSessionFilters,
	matchesWorkspaceLayoutFilters,
	toConnectionHistoryRecord,
	workspaceMembershipKey
} from './mappers';

export class InMemoryTermixServicesRepository implements TermixServicesRepository {
	private readonly users = new Map<string, UserRecord>();
	private readonly userEmails = new Map<string, string>();
	private readonly workspaces = new Map<string, WorkspaceRecord>();
	private readonly workspaceMemberships = new Map<string, WorkspaceMembershipRecord>();
	private readonly hosts = new Map<string, HostRecord>();
	private readonly hostShareInvitations = new Map<string, HostShareInvitationRecord>();
	private readonly credentials = new Map<string, CredentialRecord>();
	private readonly tickets = new Map<string, SessionTicketRecord>();
	private readonly connectionSessions = new Map<string, ConnectionSessionRecord>();
	private readonly sshTunnelProfiles = new Map<string, SshTunnelProfileRecord>();
	private readonly sshTunnelSessions = new Map<string, SshTunnelSessionRecord>();
	private readonly workspaceLayouts = new Map<string, WorkspaceLayoutRecord>();
	private readonly sshLiveSessions = new Map<string, SshLiveSessionRecord>();
	private readonly sshAttachTickets = new Map<string, SshAttachTicketRecord>();
	private readonly rdpLiveSessions = new Map<string, RdpLiveSessionRecord>();

	createUser(user: UserRecord, emails: string[] = []): UserRecord {
		this.users.set(user.id, user);
		for (const email of emails) this.userEmails.set(email.toLowerCase(), user.id);
		return user;
	}

	async findUserForShare(login: string): Promise<UserRecord | null> {
		const normalized = login.trim().toLowerCase();
		if (!normalized) return null;
		const user =
			[...this.users.values()].find(
				(candidate) => candidate.username.toLowerCase() === normalized
			) ?? this.users.get(this.userEmails.get(normalized) ?? '');
		if (!user || user.disabledAt) return null;
		return user;
	}

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
		for (const [sessionId, session] of this.rdpLiveSessions.entries()) {
			if (session.hostId === id) this.rdpLiveSessions.delete(sessionId);
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

	async createHostShareInvitation(
		invitation: HostShareInvitationRecord
	): Promise<HostShareInvitationRecord> {
		this.hostShareInvitations.set(invitation.id, invitation);
		return invitation;
	}

	async listPendingHostShareInvitations(userId: string): Promise<HostShareInvitationRecord[]> {
		return [...this.hostShareInvitations.values()].filter(
			(invitation) => invitation.recipientUserId === userId && invitation.status === 'pending'
		);
	}

	async getHostShareInvitation(
		userId: string,
		id: string
	): Promise<HostShareInvitationRecord | null> {
		const invitation = this.hostShareInvitations.get(id);
		if (!invitation || invitation.recipientUserId !== userId) return null;
		return invitation;
	}

	async updateHostShareInvitation(
		userId: string,
		id: string,
		patch: Partial<HostShareInvitationRecord>
	): Promise<HostShareInvitationRecord | null> {
		const invitation = await this.getHostShareInvitation(userId, id);
		if (!invitation) return null;
		const updated = { ...invitation, ...patch, id, recipientUserId: invitation.recipientUserId };
		this.hostShareInvitations.set(id, updated);
		return updated;
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

	async listRdpLiveSessions(userId: string): Promise<RdpLiveSessionRecord[]> {
		return [...this.rdpLiveSessions.values()].filter((session) => session.userId === userId);
	}

	async getRdpLiveSession(userId: string, id: string): Promise<RdpLiveSessionRecord | null> {
		const session = this.rdpLiveSessions.get(id);
		return session?.userId === userId ? session : null;
	}

	async createRdpLiveSession(session: RdpLiveSessionRecord): Promise<RdpLiveSessionRecord> {
		this.rdpLiveSessions.set(session.id, session);
		return session;
	}

	async updateRdpLiveSession(
		userId: string,
		id: string,
		patch: RdpLiveSessionPatch
	): Promise<RdpLiveSessionRecord | null> {
		const session = await this.getRdpLiveSession(userId, id);
		if (!session) return null;
		const updated = { ...session, ...patch, id, userId };
		this.rdpLiveSessions.set(id, updated);
		return updated;
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
