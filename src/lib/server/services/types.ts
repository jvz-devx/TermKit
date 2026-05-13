import type { CredentialEncryptionContext } from '$lib/server/crypto/credentials';

export const protocols = ['ssh', 'rdp', 'vnc', 'telnet'] as const;
export type HostProtocol = (typeof protocols)[number];

export const credentialKinds = ['password', 'ssh_key'] as const;
export type CredentialKind = (typeof credentialKinds)[number];

export const connectionSessionStatuses = ['starting', 'active', 'ended', 'failed'] as const;
export type ConnectionSessionStatus = (typeof connectionSessionStatuses)[number];

export interface HostRecord {
	id: string;
	userId: string;
	name: string;
	protocol: HostProtocol;
	hostname: string;
	port: number;
	username: string | null;
	credentialId: string | null;
	folder: string | null;
	tags: string[];
	notes: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CredentialRecord {
	id: string;
	userId: string;
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
	hostId: string | null;
	protocol: HostProtocol;
	status: ConnectionSessionStatus;
	startedAt: Date;
	endedAt: Date | null;
	errorCode: string | null;
	updatedAt: Date;
}

export type ConnectionSessionPatch = Partial<
	Pick<ConnectionSessionRecord, 'status' | 'endedAt' | 'errorCode' | 'updatedAt'>
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
}

export interface TermixServicesRepository
	extends
		HostRepository,
		CredentialRepository,
		SessionTicketRepository,
		ConnectionSessionRepository {}
