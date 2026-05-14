import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialEncryptionError } from '$lib/server/crypto/credentials';
import {
	credentialPassphraseContext,
	credentialSecretContext
} from '$lib/server/services/credentials';
import {
	ServiceNotFoundError,
	TicketConsumedError,
	TicketExpiredError,
	TicketInvalidError
} from '$lib/server/services/errors';
import { hostService, type HostService } from '$lib/server/services/hosts';
import { termixRepository } from '$lib/server/services/repository';
import type { SshAttachTicket } from '$lib/server/ssh-live/types';
import {
	parseSessionTicketTargetSnapshot,
	sessionTicketService,
	type SessionTicketService
} from '$lib/server/services/session-tickets';
import {
	sshLiveSessionService,
	type SshLiveSessionService
} from '$lib/server/services/ssh-live-sessions';
import type {
	CredentialCrypto,
	CredentialRecord,
	CredentialRepository,
	HostProtocol
} from '$lib/server/services/types';
import type { ConsumedTicket, Credential, Protocol, TicketConsumer } from '$lib/server/protocols';
import { toSshJumpHostConfig } from '$lib/termix/host-metadata';

export class SessionTicketConsumer implements TicketConsumer {
	constructor(
		private readonly tickets: SessionTicketService = sessionTicketService,
		private readonly hosts: HostService = hostService,
		private readonly credentials: CredentialRepository = termixRepository,
		private readonly crypto: CredentialCrypto = new AesGcmCredentialCrypto()
	) {}

	async consume(
		ticket: string,
		protocol: Protocol,
		userId?: string
	): Promise<ConsumedTicket | null> {
		try {
			const now = new Date();
			const record = await this.tickets.validateForConsume(
				ticket,
				now,
				userId,
				protocol as HostProtocol
			);
			const snapshot = parseSessionTicketTargetSnapshot(record);
			await this.hosts.get(record.userId, record.hostId);
			const credential = await resolveCredential(
				record.userId,
				snapshot.host.credentialId,
				this.credentials,
				this.crypto
			);
			const consumed = await this.tickets.consume(ticket, now, userId, protocol as HostProtocol);
			if (consumed.protocol !== protocol) return null;

			return {
				ticketId: consumed.id,
				userId: consumed.userId,
				hostId: consumed.hostId,
				protocol,
				target: {
					host: snapshot.host.hostname,
					port: snapshot.host.port,
					username: snapshot.host.username ?? credential?.username,
					credential: credential ?? undefined,
					jumpHost: toSshJumpHostConfig(snapshot.host.metadata.sshJumpHost) ?? undefined
				},
				metadata: {
					...snapshot.host.metadata,
					...(snapshot.host.credentialId ? { credentialId: snapshot.host.credentialId } : {})
				}
			};
		} catch (error) {
			if (
				error instanceof ServiceNotFoundError ||
				error instanceof TicketConsumedError ||
				error instanceof TicketExpiredError ||
				error instanceof TicketInvalidError
			) {
				return null;
			}

			if (error instanceof CredentialEncryptionError) {
				throw error;
			}

			throw error;
		}
	}
}

export class LiveSshAttachTicketConsumer {
	constructor(
		private readonly liveSessions: SshLiveSessionService = sshLiveSessionService,
		private readonly hosts: HostService = hostService,
		private readonly credentials: CredentialRepository = termixRepository,
		private readonly crypto: CredentialCrypto = new AesGcmCredentialCrypto()
	) {}

	async consume(ticket: string, userId: string): Promise<SshAttachTicket | null> {
		try {
			const consumed = await this.liveSessions.consumeAttachTicket(ticket, new Date(), userId);
			const consumedAt = consumed.consumedAt ?? new Date();
			const session = await this.liveSessions.get(
				consumed.userId,
				consumed.sshLiveSessionId,
				consumedAt
			);
			const host = await this.hosts.get(consumed.userId, session.hostId);
			const credential = await resolveCredential(
				consumed.userId,
				host.credentialId,
				this.credentials,
				this.crypto
			);

			return {
				ticketId: consumed.id,
				userId: consumed.userId,
				sshLiveSessionId: consumed.sshLiveSessionId,
				consumedAt,
				session: {
					ticketId: consumed.sshLiveSessionId,
					userId: consumed.userId,
					hostId: session.hostId,
					protocol: 'ssh',
					target: {
						host: host.hostname,
						port: host.port,
						username: host.username ?? credential?.username,
						credential: credential ?? undefined,
						jumpHost: toSshJumpHostConfig(host.metadata.sshJumpHost) ?? undefined
					},
					metadata: {
						...host.metadata,
						...(host.credentialId ? { credentialId: host.credentialId } : {})
					}
				},
				terminalCols: session.terminalCols,
				terminalRows: session.terminalRows
			};
		} catch (error) {
			if (
				error instanceof ServiceNotFoundError ||
				error instanceof TicketConsumedError ||
				error instanceof TicketExpiredError ||
				error instanceof TicketInvalidError
			) {
				return null;
			}

			if (error instanceof CredentialEncryptionError) {
				throw error;
			}

			throw error;
		}
	}
}

export function createSessionTicketConsumer(): TicketConsumer {
	return new SessionTicketConsumer();
}

export function createSshAttachTicketConsumer(): LiveSshAttachTicketConsumer {
	return new LiveSshAttachTicketConsumer();
}

async function resolveCredential(
	userId: string,
	credentialId: string | null,
	credentials: CredentialRepository,
	crypto: CredentialCrypto
): Promise<Credential | null> {
	if (!credentialId) return null;

	const credential = await credentials.getCredential(userId, credentialId);
	if (!credential) return null;

	return toProtocolCredential(credential, crypto);
}

function toProtocolCredential(credential: CredentialRecord, crypto: CredentialCrypto): Credential {
	const secret = crypto.decrypt(
		{
			ciphertext: credential.encryptedSecret,
			metadata: credential.encryption
		},
		credentialSecretContext(credential.userId, credential.id)
	);
	const username = credential.username ?? undefined;

	if (credential.kind === 'ssh_key') {
		const passphrase = decryptPassphrase(credential, crypto);

		return {
			kind: 'ssh_key',
			username,
			privateKey: secret,
			passphrase
		};
	}

	return {
		kind: 'password',
		username,
		password: secret
	};
}

function decryptPassphrase(
	credential: CredentialRecord,
	crypto: CredentialCrypto
): string | undefined {
	const encrypted = credential.metadata.encryptedPassphrase;
	if (isEncryptedMetadataSecret(encrypted)) {
		return crypto.decrypt(
			{
				ciphertext: encrypted.ciphertext,
				metadata: encrypted.encryption
			},
			credentialPassphraseContext(credential.userId, credential.id)
		);
	}

	return typeof credential.metadata.passphrase === 'string'
		? credential.metadata.passphrase
		: undefined;
}

function isEncryptedMetadataSecret(
	value: unknown
): value is { ciphertext: string; encryption: CredentialRecord['encryption'] } {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as { ciphertext?: unknown }).ciphertext === 'string' &&
		isEncryptionMetadata((value as { encryption?: unknown }).encryption)
	);
}

function isEncryptionMetadata(value: unknown): value is CredentialRecord['encryption'] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const metadata = value as Partial<CredentialRecord['encryption']>;
	return (
		metadata.algorithm === 'aes-256-gcm' &&
		typeof metadata.keyVersion === 'number' &&
		typeof metadata.iv === 'string' &&
		typeof metadata.authTag === 'string' &&
		typeof metadata.salt === 'string'
	);
}
