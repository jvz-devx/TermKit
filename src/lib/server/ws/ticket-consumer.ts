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
import {
	parseSessionTicketTargetSnapshot,
	sessionTicketService,
	type SessionTicketService
} from '$lib/server/services/session-tickets';
import type {
	CredentialCrypto,
	CredentialRecord,
	CredentialRepository,
	HostProtocol
} from '$lib/server/services/types';
import type { ConsumedTicket, Credential, Protocol, TicketConsumer } from '$lib/server/protocols';

export class SessionTicketConsumer implements TicketConsumer {
	constructor(
		private readonly tickets: SessionTicketService = sessionTicketService,
		private readonly hosts: HostService = hostService,
		private readonly credentials: CredentialRepository = termixRepository,
		private readonly crypto: CredentialCrypto = new AesGcmCredentialCrypto()
	) {}

	async consume(ticket: string, protocol: Protocol): Promise<ConsumedTicket | null> {
		try {
			const record = await this.tickets.validateForConsume(
				ticket,
				new Date(),
				undefined,
				protocol as HostProtocol
			);
			const snapshot = parseSessionTicketTargetSnapshot(record);
			await this.hosts.get(record.userId, record.hostId);
			const credential = await this.resolveCredential(record.userId, snapshot.host.credentialId);
			const consumed = await this.tickets.consume(
				ticket,
				new Date(),
				undefined,
				protocol as HostProtocol
			);

			return {
				ticketId: consumed.id,
				userId: consumed.userId,
				hostId: consumed.hostId,
				protocol: consumed.protocol,
				target: {
					host: snapshot.host.hostname,
					port: snapshot.host.port,
					username: snapshot.host.username ?? credential?.username,
					credential: credential ?? undefined
				},
				metadata: snapshot.host.credentialId
					? { credentialId: snapshot.host.credentialId }
					: undefined
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

	private async resolveCredential(
		userId: string,
		credentialId: string | null
	): Promise<Credential | null> {
		if (!credentialId) return null;

		const credential = await this.credentials.getCredential(userId, credentialId);
		if (!credential) return null;

		return this.toProtocolCredential(userId, credential);
	}

	private toProtocolCredential(userId: string, credential: CredentialRecord): Credential {
		const secret = this.crypto.decrypt(
			{
				ciphertext: credential.encryptedSecret,
				metadata: credential.encryption
			},
			credentialSecretContext(userId, credential.id)
		);
		const username = credential.username ?? undefined;

		if (credential.kind === 'ssh_key') {
			const passphrase = this.decryptPassphrase(userId, credential);

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

	private decryptPassphrase(userId: string, credential: CredentialRecord): string | undefined {
		const encrypted = credential.metadata.encryptedPassphrase;
		if (isEncryptedMetadataSecret(encrypted)) {
			return this.crypto.decrypt(
				{
					ciphertext: encrypted.ciphertext,
					metadata: encrypted.encryption
				},
				credentialPassphraseContext(userId, credential.id)
			);
		}

		return typeof credential.metadata.passphrase === 'string'
			? credential.metadata.passphrase
			: undefined;
	}
}

export function createSessionTicketConsumer(): TicketConsumer {
	return new SessionTicketConsumer();
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
