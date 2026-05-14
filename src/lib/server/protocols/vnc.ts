import type { ProtocolAdapter } from './types';
import { connectTcpTarget, proxyTcpBytes } from './tcp';
import { credentialSecretContext } from '$lib/server/services/credentials';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { ServiceValidationError } from '$lib/server/services/errors';
import { termixRepository } from '$lib/server/services/repository';
import type { SessionTicketTargetSnapshot } from '$lib/server/services/session-tickets';
import type { CredentialCrypto, CredentialRepository } from '$lib/server/services/types';

export type VncLaunchCredentials = {
	username: string | null;
	password: string | null;
	source: 'none' | 'saved-password';
	unavailableReason: string | null;
};

export function createVncAdapter(): ProtocolAdapter {
	return {
		protocol: 'vnc',
		handle(socket, ticket) {
			const target = connectTcpTarget(ticket.target.host, ticket.target.port);
			proxyTcpBytes(socket, target);
		}
	};
}

export async function resolveVncLaunchCredentials(
	userId: string,
	target: SessionTicketTargetSnapshot,
	repository: CredentialRepository = termixRepository,
	crypto: CredentialCrypto = new AesGcmCredentialCrypto()
): Promise<VncLaunchCredentials> {
	const credentialId = target.host.credentialId;

	if (!credentialId) {
		return {
			username: target.host.username,
			password: null,
			source: 'none',
			unavailableReason: null
		};
	}

	const credential = await repository.getCredential(userId, credentialId);
	if (!credential) {
		throw new ServiceValidationError(['VNC credential is unavailable']);
	}
	if (credential.kind !== 'password') {
		throw new ServiceValidationError(['VNC saved credential must be a password credential']);
	}

	// noVNC performs RFB security negotiation in the browser. With the current
	// authenticated WebSocket-to-TCP bridge, password-protected targets can only
	// use saved credentials by placing this launch-scoped password in browser
	// memory. The password is never embedded in tickets, URLs, or session cache.
	const password = crypto.decrypt(
		{
			ciphertext: credential.encryptedSecret,
			metadata: credential.encryption
		},
		credentialSecretContext(credential.userId, credential.id)
	);

	return {
		username: credential.username ?? target.host.username,
		password,
		source: 'saved-password',
		unavailableReason: null
	};
}
