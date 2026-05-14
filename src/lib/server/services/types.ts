import type { CredentialEncryptionContext } from '$lib/server/crypto/credentials';

export const protocols = ['ssh', 'rdp', 'vnc', 'telnet'] as const;
export type HostProtocol = (typeof protocols)[number];

export const credentialKinds = ['password', 'ssh_key'] as const;
export type CredentialKind = (typeof credentialKinds)[number];

export const workspaceMemberRoles = ['owner', 'member'] as const;
export type WorkspaceMemberRole = (typeof workspaceMemberRoles)[number];

export const connectionSessionStatuses = ['starting', 'active', 'ended', 'failed'] as const;
export type ConnectionSessionStatus = (typeof connectionSessionStatuses)[number];

export const sshLiveSessionStatuses = [
	'starting',
	'attached',
	'detached',
	'ended',
	'failed',
	'stale'
] as const;
export type SshLiveSessionStatus = (typeof sshLiveSessionStatuses)[number];

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
	protocol: HostProtocol;
	status: ConnectionSessionStatus;
	startedAt: Date;
	endedAt: Date | null;
	errorCode: string | null;
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
	protocol: HostProtocol;
	startedAt: Date;
	endedAt: Date | null;
	durationMs: number | null;
	status: ConnectionSessionStatus;
	errorReason: string | null;
}

export interface ConnectionHistoryFilters {
	workspaceId?: string | null;
	hostId?: string | null;
	userId?: string | null;
	protocol?: HostProtocol | null;
	status?: ConnectionSessionStatus | null;
	startedAfter?: Date | null;
	startedBefore?: Date | null;
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

export type ConnectionSessionPatch = Partial<
	Pick<ConnectionSessionRecord, 'status' | 'endedAt' | 'errorCode' | 'updatedAt'>
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
		| 'terminalCols'
		| 'terminalRows'
		| 'updatedAt'
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

export interface TermixServicesRepository
	extends
		HostRepository,
		CredentialRepository,
		WorkspaceRepository,
		SessionTicketRepository,
		ConnectionSessionRepository,
		SshLiveSessionRepository {}
