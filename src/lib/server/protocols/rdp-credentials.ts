import { credentialSecretContext } from '$lib/server/services/credentials';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { ServiceValidationError } from '$lib/server/services/errors';
import { termixRepository } from '$lib/server/services/repository';
import type { SessionTicketTargetSnapshot } from '$lib/server/services/session-tickets';
import type { CredentialCrypto, CredentialRepository } from '$lib/server/services/types';

export type RdpLaunchCredentials = {
	username: string | null;
	domain: string | null;
	password: string | null;
	source: 'none' | 'saved-password';
	unavailableReason: string | null;
};

export async function resolveRdpLaunchCredentials(
	userId: string,
	target: SessionTicketTargetSnapshot,
	repository: CredentialRepository = termixRepository,
	crypto: CredentialCrypto = new AesGcmCredentialCrypto()
): Promise<RdpLaunchCredentials> {
	const credentialId = target.host.credentialId;

	if (!credentialId) {
		return {
			username: target.host.username,
			domain: readDomain(target.host.metadata),
			password: null,
			source: 'none',
			unavailableReason: null
		};
	}

	const credential = await repository.getCredential(userId, credentialId);
	if (!credential) {
		throw new ServiceValidationError(['RDP credential is unavailable']);
	}
	if (credential.kind !== 'password' && credential.kind !== 'rdp_password') {
		throw new ServiceValidationError(['RDP saved credential must be a password credential']);
	}

	// IronRDP performs target authentication in the browser. With the current
	// Gateway flow, saved passwords must be staged in browser memory for one
	// launch and cleared by the pane after the connect attempt is built.
	const password = crypto.decrypt(
		{
			ciphertext: credential.encryptedSecret,
			metadata: credential.encryption
		},
		credentialSecretContext(credential.userId, credential.id)
	);

	return {
		username: credential.username ?? target.host.username,
		domain: readDomain(credential.metadata) ?? readDomain(target.host.metadata),
		password,
		source: 'saved-password',
		unavailableReason: null
	};
}

function readDomain(metadata: Record<string, unknown>): string | null {
	const domain = metadata.domain;
	return typeof domain === 'string' && domain.trim() ? domain.trim() : null;
}
