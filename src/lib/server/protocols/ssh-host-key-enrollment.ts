import { Client, type ConnectConfig } from 'ssh2';
import { ServiceValidationError } from '$lib/server/services/errors';
import { resolveSftpTarget, type SftpTarget } from './sftp';
import {
	buildTrustedSshConnectConfig,
	getDefaultSshHostKeyTrustStore,
	getSshHostKeyPin,
	readSshHostKeyTrustPolicy,
	type SshHostKeyPin,
	type SshHostKeyTrustError,
	type SshHostKeyTrustIdentity,
	type SshHostKeyTrustPolicy,
	type SshHostKeyTrustStore
} from './ssh-host-trust';

export type SshHostKeyTrustSummary = {
	hostId: string;
	hostname: string;
	port: number;
	status: 'pinned' | 'unknown';
	fingerprint: string | null;
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	trust: SshHostKeyPin['trust'] | null;
	trustOnFirstUse: boolean;
	productionTofuBlocked: boolean;
	message: string;
};

export async function getSshHostKeyTrustSummary(
	userId: string,
	hostId: string,
	options: {
		store?: SshHostKeyTrustStore;
		policy?: SshHostKeyTrustPolicy;
	} = {}
): Promise<SshHostKeyTrustSummary> {
	const target = await resolveSftpTarget(userId, hostId);
	return summarizeSshHostKeyTrust(target, options);
}

export async function enrollSshHostKey(
	userId: string,
	hostId: string,
	options: {
		store?: SshHostKeyTrustStore;
		createClient?: () => Client;
	} = {}
): Promise<SshHostKeyTrustSummary> {
	const target = await resolveSftpTarget(userId, hostId);
	const store = options.store ?? getDefaultSshHostKeyTrustStore();
	const identity = targetIdentity(target);
	const existing = getSshHostKeyPin(identity, store);

	if (existing) return summarizeSshHostKeyTrust(target, { store });

	await connectForEnrollment(target, identity, store, options.createClient ?? (() => new Client()));
	return summarizeSshHostKeyTrust(target, { store });
}

export function summarizeSshHostKeyTrust(
	target: SftpTarget,
	options: {
		store?: SshHostKeyTrustStore;
		policy?: SshHostKeyTrustPolicy;
	} = {}
): SshHostKeyTrustSummary {
	const policy = options.policy ?? readSshHostKeyTrustPolicy();
	const pin = getSshHostKeyPin(targetIdentity(target), options.store);

	if (pin) {
		return {
			hostId: target.hostId,
			hostname: target.host,
			port: target.port,
			status: 'pinned',
			fingerprint: pin.fingerprint,
			firstSeenAt: pin.firstSeenAt,
			lastSeenAt: pin.lastSeenAt,
			trust: pin.trust,
			trustOnFirstUse: policy.trustOnFirstUse,
			productionTofuBlocked: policy.productionTofuBlocked,
			message: 'SSH host key is pinned for this host.'
		};
	}

	return {
		hostId: target.hostId,
		hostname: target.host,
		port: target.port,
		status: 'unknown',
		fingerprint: null,
		firstSeenAt: null,
		lastSeenAt: null,
		trust: null,
		trustOnFirstUse: policy.trustOnFirstUse,
		productionTofuBlocked: policy.productionTofuBlocked,
		message: policy.productionTofuBlocked
			? 'Automatic first-use enrollment is blocked in production.'
			: 'SSH host key is not enrolled yet.'
	};
}

function connectForEnrollment(
	target: SftpTarget,
	identity: SshHostKeyTrustIdentity,
	store: SshHostKeyTrustStore,
	createClient: () => Client
): Promise<void> {
	const connection = createClient();
	let hostKeyTrustError: SshHostKeyTrustError | undefined;
	const config: ConnectConfig = buildTrustedSshConnectConfig(
		{
			host: target.host,
			port: target.port,
			username: target.credential?.username ?? target.username,
			password: target.credential?.kind === 'password' ? target.credential.password : undefined,
			privateKey: target.credential?.kind === 'ssh_key' ? target.credential.privateKey : undefined,
			passphrase: target.credential?.kind === 'ssh_key' ? target.credential.passphrase : undefined,
			readyTimeout: 10_000
		},
		identity,
		{
			store,
			policy: {
				trustOnFirstUse: true,
				productionTofuBlocked: false
			},
			onFailure(error) {
				hostKeyTrustError = error;
			}
		}
	);

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			connection.off('ready', onReady);
			connection.off('error', onError);
			connection.off('close', onClose);
			connection.off('end', onClose);
		};
		const resolveIfPinned = () => {
			const pin = getSshHostKeyPin(identity, store);
			if (pin) {
				resolve();
				return true;
			}
			return false;
		};
		const onReady = () => {
			cleanup();
			connection.end();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			connection.end();
			if (hostKeyTrustError) {
				reject(hostKeyTrustError);
				return;
			}
			if (resolveIfPinned()) return;
			reject(error);
		};
		const onClose = () => {
			cleanup();
			if (resolveIfPinned()) return;
			reject(new ServiceValidationError(['SSH host key enrollment did not complete']));
		};

		connection.once('ready', onReady);
		connection.once('error', onError);
		connection.once('close', onClose);
		connection.once('end', onClose);
		connection.connect(config);
	});
}

function targetIdentity(target: SftpTarget): SshHostKeyTrustIdentity {
	return {
		userId: target.userId,
		hostId: target.hostId,
		hostname: target.host,
		port: target.port
	};
}
