import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import {
	credentialPassphraseContext,
	credentialSecretContext
} from '$lib/server/services/credentials';
import { ServiceNotFoundError, ServiceValidationError } from '$lib/server/services/errors';
import { termixRepository } from '$lib/server/services/repository';
import type {
	CredentialCrypto,
	CredentialRecord,
	CredentialRepository,
	HostRepository
} from '$lib/server/services/types';
import { toSshJumpHostConfig } from '$lib/termix/host-metadata';
import {
	buildTrustedSshConnectConfig,
	type SshHostKeyTrustError,
	type SshHostKeyTrustStore
} from './ssh-host-trust';
import type { Credential, TicketTarget } from './types';

export type SshConnectTarget = TicketTarget & {
	userId: string;
	hostId: string;
};

export type SshConnectOptions = {
	repository?: HostRepository & CredentialRepository;
	crypto?: CredentialCrypto;
	trustStore?: SshHostKeyTrustStore;
	onHostKeyTrustFailure?: (error: SshHostKeyTrustError) => void;
};

export async function connectTrustedSsh(
	target: SshConnectTarget,
	options: SshConnectOptions = {}
): Promise<Client> {
	if (!target.jumpHost) return connectDirectSsh(target, options);

	const jumpTarget = await _resolveJumpHostTarget(target, options);
	const jumpConnection = await connectDirectSsh(jumpTarget, options);

	try {
		const sock = await openJumpForward(jumpConnection, target.host, target.port);
		const targetConnection = await connectDirectSsh(target, options, sock);
		const closeJump = () => jumpConnection.end();
		targetConnection.once('close', closeJump);
		targetConnection.once('end', closeJump);
		targetConnection.once('error', closeJump);
		return targetConnection;
	} catch (error) {
		jumpConnection.end();
		throw error;
	}
}

export async function _resolveJumpHostTarget(
	target: SshConnectTarget,
	{
		repository = termixRepository,
		crypto = new AesGcmCredentialCrypto()
	}: Pick<SshConnectOptions, 'repository' | 'crypto'> = {}
): Promise<SshConnectTarget> {
	if (!target.jumpHost) {
		throw new ServiceValidationError(['SSH jump host is required']);
	}

	const host = await repository.getHost(target.userId, target.jumpHost.hostId);
	if (!host) throw new ServiceNotFoundError('SSH jump host not found');
	if (host.protocol !== 'ssh') {
		throw new ServiceValidationError(['SSH jump host must be an SSH host']);
	}

	const credential = host.credentialId
		? await repository.getCredential(target.userId, host.credentialId)
		: null;
	if (host.credentialId && !credential)
		throw new ServiceNotFoundError('SSH jump credential not found');

	const username = credential?.username ?? host.username ?? undefined;
	if (!username) throw new ServiceValidationError(['SSH jump host username is required']);

	return {
		userId: target.userId,
		hostId: host.id,
		host: host.hostname,
		port: host.port,
		username,
		credential: credential ? decryptSshCredential(credential, crypto) : undefined,
		jumpHost: toSshJumpHostConfig(host.metadata.sshJumpHost) ?? undefined
	};
}

function connectDirectSsh(
	target: SshConnectTarget,
	options: SshConnectOptions,
	sock?: ClientChannel
): Promise<Client> {
	const connection = new Client();
	let hostKeyTrustError: SshHostKeyTrustError | undefined;
	const credential = target.credential;
	const config: ConnectConfig = buildTrustedSshConnectConfig(
		{
			host: target.host,
			port: target.port,
			username: credential?.username ?? target.username,
			password: credential?.kind === 'password' ? credential.password : undefined,
			privateKey: credential?.kind === 'ssh_key' ? credential.privateKey : undefined,
			passphrase: credential?.kind === 'ssh_key' ? credential.passphrase : undefined,
			...(sock ? { sock } : {})
		},
		{
			userId: target.userId,
			hostId: target.hostId,
			hostname: target.host,
			port: target.port
		},
		{
			store: options.trustStore,
			onFailure(error) {
				hostKeyTrustError = error;
				options.onHostKeyTrustFailure?.(error);
			}
		}
	);

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			connection.off('ready', onReady);
			connection.off('error', onError);
		};
		const onReady = () => {
			cleanup();
			resolve(connection);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(hostKeyTrustError ?? error);
		};

		connection.once('ready', onReady);
		connection.once('error', onError);
		connection.connect(config);
	});
}

function openJumpForward(
	jumpConnection: Client,
	targetHost: string,
	targetPort: number
): Promise<ClientChannel> {
	return new Promise((resolve, reject) => {
		jumpConnection.forwardOut('127.0.0.1', 0, targetHost, targetPort, (error, channel) => {
			if (error) reject(error);
			else resolve(channel);
		});
	});
}

function decryptSshCredential(credential: CredentialRecord, crypto: CredentialCrypto): Credential {
	const secret = crypto.decrypt(
		{
			ciphertext: credential.encryptedSecret,
			metadata: credential.encryption
		},
		credentialSecretContext(credential.userId, credential.id)
	);

	if (credential.kind === 'password') {
		return {
			kind: 'password',
			username: credential.username ?? undefined,
			password: secret
		};
	}

	return {
		kind: 'ssh_key',
		username: credential.username ?? undefined,
		privateKey: secret,
		passphrase: decryptSshPassphrase(credential, crypto)
	};
}

function decryptSshPassphrase(
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
		typeof (value as { ciphertext?: unknown }).ciphertext === 'string' &&
		typeof (value as { encryption?: unknown }).encryption === 'object' &&
		(value as { encryption?: unknown }).encryption !== null
	);
}
