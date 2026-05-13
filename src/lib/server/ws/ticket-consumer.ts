import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import {
	ServiceNotFoundError,
	TicketConsumedError,
	TicketExpiredError
} from '$lib/server/services/errors';
import { hostService, type HostService } from '$lib/server/services/hosts';
import { termixRepository } from '$lib/server/services/repository';
import {
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
			const record = await this.tickets.consume(
				ticket,
				new Date(),
				undefined,
				protocol as HostProtocol
			);
			const host = await this.hosts.get(record.userId, record.hostId);
			const credential = await this.resolveCredential(record.userId, host.credentialId);

			return {
				ticketId: record.id,
				userId: record.userId,
				hostId: record.hostId,
				protocol: record.protocol,
				target: {
					host: host.hostname,
					port: host.port,
					username: host.username ?? credential?.username,
					credential: credential ?? undefined
				},
				metadata: host.credentialId ? { credentialId: host.credentialId } : undefined
			};
		} catch (error) {
			if (
				error instanceof ServiceNotFoundError ||
				error instanceof TicketConsumedError ||
				error instanceof TicketExpiredError
			) {
				return null;
			}

			return null;
		}
	}

	private async resolveCredential(
		userId: string,
		credentialId: string | null
	): Promise<Credential | null> {
		if (!credentialId) return null;

		const credential = await this.credentials.getCredential(userId, credentialId);
		if (!credential) return null;

		return this.toProtocolCredential(credential);
	}

	private toProtocolCredential(credential: CredentialRecord): Credential {
		const secret = this.crypto.decrypt({
			ciphertext: credential.encryptedSecret,
			metadata: credential.encryption
		});
		const username = credential.username ?? undefined;

		if (credential.kind === 'ssh_key') {
			const passphrase =
				typeof credential.metadata.passphrase === 'string'
					? credential.metadata.passphrase
					: undefined;

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
}

export function createSessionTicketConsumer(): TicketConsumer {
	return new SessionTicketConsumer();
}
