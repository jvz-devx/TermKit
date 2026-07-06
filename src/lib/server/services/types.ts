import type { CredentialEncryptionContext } from '$lib/server/crypto/credentials';

export const protocols = ['ssh', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps'] as const;
export type HostProtocol = (typeof protocols)[number];

export const connectionProtocols = [...protocols, 'sftp', 'ssh_tunnel'] as const;
export type ConnectionProtocol = (typeof connectionProtocols)[number];

export const credentialKinds = ['password', 'ssh_key', 'rdp_password'] as const;
export type CredentialKind = (typeof credentialKinds)[number];

export const workspaceMemberRoles = ['owner', 'member'] as const;
export type WorkspaceMemberRole = (typeof workspaceMemberRoles)[number];

export const hostShareInvitationStatuses = ['pending', 'accepted', 'declined'] as const;
export type HostShareInvitationStatus = (typeof hostShareInvitationStatuses)[number];

export const connectionSessionStatuses = ['starting', 'active', 'ended', 'failed'] as const;
export type ConnectionSessionStatus = (typeof connectionSessionStatuses)[number];

export const sshTunnelSessionStatuses = [
	'starting',
	'active',
	'idle',
	'ended',
	'failed',
	'expired'
] as const;
export type SshTunnelSessionStatus = (typeof sshTunnelSessionStatuses)[number];

export const sshLiveSessionStatuses = [
	'starting',
	'attached',
	'detached',
	'ended',
	'failed',
	'stale'
] as const;
export type SshLiveSessionStatus = (typeof sshLiveSessionStatuses)[number];

export const rdpLiveSessionStatuses = ['active', 'detached', 'ended', 'failed'] as const;
export type RdpLiveSessionStatus = (typeof rdpLiveSessionStatuses)[number];

export interface HostRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	name: string;
	protocol: HostProtocol;
	hostname: string;
	port: number;
	username: string | null;
	credentialId: string | null;
	folder: string | null;
	tags: string[];
	notes: string | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface CredentialRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	name: string;
	kind: CredentialKind;
	username: string | null;
	encryptedSecret: string;
	encryption: EncryptionMetadata;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface UserRecord {
	id: string;
	username: string;
	disabledAt: Date | null;
}

export interface HostShareInvitationRecord {
	id: string;
	senderUserId: string;
	recipientUserId: string;
	hostId: string | null;
	credentialId: string | null;
	includeCredentials: boolean;
	status: HostShareInvitationStatus;
	hostSnapshot: Pick<
		HostRecord,
		| 'name'
		| 'protocol'
		| 'hostname'
		| 'port'
		| 'username'
		| 'folder'
		| 'tags'
		| 'notes'
		| 'metadata'
	>;
	credentialName: string | null;
	createdAt: Date;
	updatedAt: Date;
	respondedAt: Date | null;
}

export interface SessionTicketRecord {
	id: string;
	ticketHash: string;
	userId: string;
	hostId: string;
	protocol: HostProtocol;
	target?: string;
	expiresAt: Date;
	usedAt: Date | null;
	createdAt: Date;
}

export interface ConnectionSessionRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	hostId: string | null;
	protocol: ConnectionProtocol;
	status: ConnectionSessionStatus;
	startedAt: Date;
	endedAt: Date | null;
	errorCode: string | null;
	errorMessage?: string | null;
	errorDetails?: Record<string, unknown> | null;
	updatedAt: Date;
}

export interface WorkspaceRecord {
	id: string;
	name: string;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface WorkspaceMembershipRecord {
	id: string;
	workspaceId: string;
	userId: string;
	role: WorkspaceMemberRole;
	createdAt: Date;
	updatedAt: Date;
}

export interface ConnectionHistoryRecord {
	id: string;
	userId: string;
	username: string | null;
	workspaceId: string | null;
	workspaceName: string | null;
	hostId: string | null;
	hostName: string | null;
	hostname: string | null;
	hostUsername: string | null;
	protocol: ConnectionProtocol;
	startedAt: Date;
	endedAt: Date | null;
	durationMs: number | null;
	status: ConnectionSessionStatus;
	errorReason: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	errorDetails: Record<string, unknown> | null;
}

export interface ConnectionHistoryFilters {
	workspaceId?: string | null;
	hostId?: string | null;
	userId?: string | null;
	protocol?: ConnectionProtocol | null;
	status?: ConnectionSessionStatus | null;
	startedAfter?: Date | null;
	startedBefore?: Date | null;
}

export interface SshTunnelProfileRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	sshHostId: string;
	name: string;
	targetHost: string;
	targetPort: number;
	description: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SshTunnelProfileFilters {
	workspaceId?: string | null;
	sshHostId?: string | null;
	userId?: string | null;
}

export interface SshTunnelSessionRecord {
	id: string;
	profileId: string | null;
	userId: string;
	workspaceId: string | null;
	sshHostId: string | null;
	targetHost: string;
	targetPort: number;
	publicPath: string;
	status: SshTunnelSessionStatus;
	startedAt: Date;
	endedAt: Date | null;
	lastSeenAt: Date;
	errorCode: string | null;
	errorMessage: string | null;
}

export interface SshTunnelSessionFilters {
	workspaceId?: string | null;
	sshHostId?: string | null;
	profileId?: string | null;
	userId?: string | null;
	status?: SshTunnelSessionStatus | null;
}

export interface WorkspaceLayoutRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	layoutKind: string;
	panes: Record<string, unknown>[];
	tree?: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface WorkspaceLayoutFilters {
	workspaceId?: string | null;
	layoutKind?: string | null;
}

export interface SshLiveSessionRecord {
	id: string;
	userId: string;
	hostId: string;
	title: string;
	status: SshLiveSessionStatus;
	startedAt: Date;
	lastAttachedAt: Date | null;
	detachedAt: Date | null;
	expiresAt: Date | null;
	endedAt: Date | null;
	errorCode: string | null;
	errorMessage: string | null;
	terminalCols: number;
	terminalRows: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface SshAttachTicketRecord {
	id: string;
	userId: string;
	sshLiveSessionId: string;
	ticketHash: string;
	expiresAt: Date;
	consumedAt: Date | null;
	createdAt: Date;
}

export interface RdpLiveSessionRecord {
	id: string;
	userId: string;
	hostId: string;
	title: string;
	status: RdpLiveSessionStatus;
	startedAt: Date;
	lastAttachedAt: Date | null;
	endedAt: Date | null;
	errorCode: string | null;
	errorMessage: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export type ConnectionSessionPatch = Partial<
	Pick<
		ConnectionSessionRecord,
		'status' | 'endedAt' | 'errorCode' | 'errorMessage' | 'errorDetails' | 'updatedAt'
	>
>;

export type SshTunnelProfilePatch = Partial<
	Pick<
		SshTunnelProfileRecord,
		'workspaceId' | 'sshHostId' | 'name' | 'targetHost' | 'targetPort' | 'description' | 'updatedAt'
	>
>;

export type SshTunnelSessionPatch = Partial<
	Pick<
		SshTunnelSessionRecord,
		| 'profileId'
		| 'workspaceId'
		| 'sshHostId'
		| 'targetHost'
		| 'targetPort'
		| 'publicPath'
		| 'status'
		| 'endedAt'
		| 'lastSeenAt'
		| 'errorCode'
		| 'errorMessage'
	>
>;

export type WorkspaceLayoutPatch = Partial<
	Pick<WorkspaceLayoutRecord, 'workspaceId' | 'layoutKind' | 'panes' | 'tree' | 'updatedAt'>
>;

export type SshLiveSessionPatch = Partial<
	Pick<
		SshLiveSessionRecord,
		| 'title'
		| 'status'
		| 'lastAttachedAt'
		| 'detachedAt'
		| 'expiresAt'
		| 'endedAt'
		| 'errorCode'
		| 'errorMessage'
		| 'terminalCols'
		| 'terminalRows'
		| 'updatedAt'
	>
>;

export type RdpLiveSessionPatch = Partial<
	Pick<
		RdpLiveSessionRecord,
		'title' | 'status' | 'lastAttachedAt' | 'endedAt' | 'errorCode' | 'errorMessage' | 'updatedAt'
	>
>;

export interface EncryptionMetadata {
	algorithm: 'aes-256-gcm';
	keyVersion: number;
	iv: string;
	authTag: string;
	salt: string;
	associatedData?: {
		version: 1;
		field: string;
	};
}

export interface SecretCiphertext {
	ciphertext: string;
	metadata: EncryptionMetadata;
}

export interface CredentialCrypto {
	encrypt(plaintext: string, context?: CredentialEncryptionContext): SecretCiphertext;
	decrypt(secret: SecretCiphertext, context?: CredentialEncryptionContext): string;
}

export interface HostRepository {
	listHosts(userId: string): Promise<HostRecord[]>;
	getHost(userId: string, id: string): Promise<HostRecord | null>;
	createHost(host: HostRecord): Promise<HostRecord>;
	updateHost(userId: string, id: string, patch: Partial<HostRecord>): Promise<HostRecord | null>;
	deleteHost(userId: string, id: string): Promise<boolean>;
}

export interface CredentialRepository {
	listCredentials(userId: string): Promise<CredentialRecord[]>;
	getCredential(userId: string, id: string): Promise<CredentialRecord | null>;
	createCredential(credential: CredentialRecord): Promise<CredentialRecord>;
	updateCredential(
		userId: string,
		id: string,
		patch: Partial<CredentialRecord>
	): Promise<CredentialRecord | null>;
	deleteCredential(userId: string, id: string): Promise<boolean>;
}

export interface UserRepository {
	findUserForShare(login: string): Promise<UserRecord | null>;
}

export interface HostShareInvitationRepository {
	createHostShareInvitation(
		invitation: HostShareInvitationRecord
	): Promise<HostShareInvitationRecord>;
	listPendingHostShareInvitations(userId: string): Promise<HostShareInvitationRecord[]>;
	getHostShareInvitation(userId: string, id: string): Promise<HostShareInvitationRecord | null>;
	updateHostShareInvitation(
		userId: string,
		id: string,
		patch: Partial<HostShareInvitationRecord>
	): Promise<HostShareInvitationRecord | null>;
}

export interface WorkspaceRepository {
	listWorkspaces(userId: string): Promise<WorkspaceRecord[]>;
	getWorkspace(userId: string, id: string): Promise<WorkspaceRecord | null>;
	getWorkspaceById(id: string): Promise<WorkspaceRecord | null>;
	createWorkspace(workspace: WorkspaceRecord): Promise<WorkspaceRecord>;
	updateWorkspace(id: string, patch: Partial<WorkspaceRecord>): Promise<WorkspaceRecord | null>;
	createWorkspaceMembership(
		membership: WorkspaceMembershipRecord
	): Promise<WorkspaceMembershipRecord>;
	listWorkspaceMemberships(workspaceId: string): Promise<WorkspaceMembershipRecord[]>;
	listUserWorkspaceMemberships(userId: string): Promise<WorkspaceMembershipRecord[]>;
	getWorkspaceMembership(
		workspaceId: string,
		userId: string
	): Promise<WorkspaceMembershipRecord | null>;
	updateWorkspaceMembership(
		workspaceId: string,
		userId: string,
		patch: Partial<WorkspaceMembershipRecord>
	): Promise<WorkspaceMembershipRecord | null>;
	deleteWorkspaceMembership(workspaceId: string, userId: string): Promise<boolean>;
}

export interface SessionTicketRepository {
	createTicket(ticket: SessionTicketRecord): Promise<SessionTicketRecord>;
	getTicketByHash(ticketHash: string): Promise<SessionTicketRecord | null>;
	consumeTicket(ticketHash: string, usedAt: Date): Promise<SessionTicketRecord | null>;
}

export interface ConnectionSessionRepository {
	createConnectionSession(session: ConnectionSessionRecord): Promise<ConnectionSessionRecord>;
	getConnectionSession(id: string): Promise<ConnectionSessionRecord | null>;
	updateConnectionSession(
		id: string,
		patch: ConnectionSessionPatch
	): Promise<ConnectionSessionRecord | null>;
	listConnectionHistory(
		userId: string,
		filters?: ConnectionHistoryFilters
	): Promise<ConnectionHistoryRecord[]>;
}

export interface SshTunnelProfileRepository {
	listSshTunnelProfiles(
		userId: string,
		filters?: SshTunnelProfileFilters
	): Promise<SshTunnelProfileRecord[]>;
	getSshTunnelProfile(userId: string, id: string): Promise<SshTunnelProfileRecord | null>;
	createSshTunnelProfile(profile: SshTunnelProfileRecord): Promise<SshTunnelProfileRecord>;
	updateSshTunnelProfile(
		userId: string,
		id: string,
		patch: SshTunnelProfilePatch
	): Promise<SshTunnelProfileRecord | null>;
	deleteSshTunnelProfile(userId: string, id: string): Promise<boolean>;
}

export interface SshTunnelSessionRepository {
	listSshTunnelSessions(
		userId: string,
		filters?: SshTunnelSessionFilters
	): Promise<SshTunnelSessionRecord[]>;
	getSshTunnelSession(userId: string, id: string): Promise<SshTunnelSessionRecord | null>;
	createSshTunnelSession(session: SshTunnelSessionRecord): Promise<SshTunnelSessionRecord>;
	updateSshTunnelSession(
		userId: string,
		id: string,
		patch: SshTunnelSessionPatch
	): Promise<SshTunnelSessionRecord | null>;
}

export interface WorkspaceLayoutRepository {
	listWorkspaceLayouts(
		userId: string,
		filters?: WorkspaceLayoutFilters
	): Promise<WorkspaceLayoutRecord[]>;
	getWorkspaceLayout(userId: string, id: string): Promise<WorkspaceLayoutRecord | null>;
	createWorkspaceLayout(layout: WorkspaceLayoutRecord): Promise<WorkspaceLayoutRecord>;
	updateWorkspaceLayout(
		userId: string,
		id: string,
		patch: WorkspaceLayoutPatch
	): Promise<WorkspaceLayoutRecord | null>;
	deleteWorkspaceLayout(userId: string, id: string): Promise<boolean>;
}

export interface SshLiveSessionRepository {
	listSshLiveSessions(userId: string): Promise<SshLiveSessionRecord[]>;
	getSshLiveSession(userId: string, id: string): Promise<SshLiveSessionRecord | null>;
	findReusableSshLiveSession(userId: string, hostId: string): Promise<SshLiveSessionRecord | null>;
	countOpenSshLiveSessions(userId: string): Promise<number>;
	createSshLiveSession(session: SshLiveSessionRecord): Promise<SshLiveSessionRecord>;
	updateSshLiveSession(
		userId: string,
		id: string,
		patch: SshLiveSessionPatch
	): Promise<SshLiveSessionRecord | null>;
	markStaleSshLiveSessions(now: Date): Promise<number>;
	markExpiredDetachedSshLiveSessions(now: Date): Promise<SshLiveSessionRecord[]>;
	createSshAttachTicket(ticket: SshAttachTicketRecord): Promise<SshAttachTicketRecord>;
	getSshAttachTicketByHash(ticketHash: string): Promise<SshAttachTicketRecord | null>;
	consumeSshAttachTicket(
		ticketHash: string,
		consumedAt: Date
	): Promise<SshAttachTicketRecord | null>;
}

export interface RdpLiveSessionRepository {
	listRdpLiveSessions(userId: string): Promise<RdpLiveSessionRecord[]>;
	getRdpLiveSession(userId: string, id: string): Promise<RdpLiveSessionRecord | null>;
	createRdpLiveSession(session: RdpLiveSessionRecord): Promise<RdpLiveSessionRecord>;
	updateRdpLiveSession(
		userId: string,
		id: string,
		patch: RdpLiveSessionPatch
	): Promise<RdpLiveSessionRecord | null>;
}

export interface TermixServicesRepository
	extends
		HostRepository,
		CredentialRepository,
		UserRepository,
		HostShareInvitationRepository,
		WorkspaceRepository,
		SessionTicketRepository,
		ConnectionSessionRepository,
		SshTunnelProfileRepository,
		SshTunnelSessionRepository,
		WorkspaceLayoutRepository,
		SshLiveSessionRepository,
		RdpLiveSessionRepository {}
