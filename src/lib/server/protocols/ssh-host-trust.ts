import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';
import type { ConnectConfig } from 'ssh2';

const hostKeyHash = 'sha256';
const knownHostsFileVersion = 1;

export type SshHostKeyTrustIdentity = {
	userId: string;
	hostId: string;
	hostname: string;
	port: number;
};

export type SshHostKeyPin = {
	fingerprint: string;
	hostname: string;
	port: number;
	firstSeenAt: string;
	lastSeenAt: string;
	trust: 'pinned' | 'tofu';
};

export type SshHostKeyTrustPolicy = {
	trustOnFirstUse: boolean;
	productionTofuBlocked: boolean;
};

type SshHostKeyTrustEnvironment = Partial<Record<string, string | undefined>>;

export interface SshHostKeyTrustStore {
	get(identity: SshHostKeyTrustIdentity): SshHostKeyPin | null;
	set(identity: SshHostKeyTrustIdentity, pin: SshHostKeyPin): void;
}

export class SshHostKeyTrustError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SshHostKeyTrustError';
	}
}

export class InMemorySshHostKeyTrustStore implements SshHostKeyTrustStore {
	private readonly pins = new Map<string, SshHostKeyPin>();

	get(identity: SshHostKeyTrustIdentity): SshHostKeyPin | null {
		return this.pins.get(identityKey(identity)) ?? null;
	}

	set(identity: SshHostKeyTrustIdentity, pin: SshHostKeyPin): void {
		this.pins.set(identityKey(identity), pin);
	}
}

export class JsonFileSshHostKeyTrustStore implements SshHostKeyTrustStore {
	constructor(private readonly path = defaultKnownHostsPath()) {}

	get(identity: SshHostKeyTrustIdentity): SshHostKeyPin | null {
		return this.read().pins[identityKey(identity)] ?? null;
	}

	set(identity: SshHostKeyTrustIdentity, pin: SshHostKeyPin): void {
		const knownHosts = this.read();
		knownHosts.pins[identityKey(identity)] = pin;
		this.write(knownHosts);
	}

	private read(): KnownHostsFile {
		if (!existsSync(this.path)) return emptyKnownHostsFile();

		const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
		if (!isKnownHostsFile(parsed)) {
			throw new SshHostKeyTrustError('SSH known-hosts file is invalid');
		}

		return parsed;
	}

	private write(knownHosts: KnownHostsFile): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temporaryPath = `${this.path}.${process.pid}.tmp`;
		writeFileSync(temporaryPath, `${JSON.stringify(knownHosts, null, 2)}\n`, {
			encoding: 'utf8',
			mode: 0o600
		});
		renameSync(temporaryPath, this.path);
	}
}

let defaultTrustStore: SshHostKeyTrustStore | null = null;

export function buildTrustedSshConnectConfig(
	base: ConnectConfig,
	identity: SshHostKeyTrustIdentity,
	options: {
		store?: SshHostKeyTrustStore;
		policy?: SshHostKeyTrustPolicy;
		onFailure?: (error: SshHostKeyTrustError) => void;
	} = {}
): ConnectConfig {
	const verifier = createSshHostKeyVerifier(identity, options);
	return {
		...base,
		hostHash: verifier.hostHash,
		hostVerifier: verifier.hostVerifier
	};
}

export function createSshHostKeyVerifier(
	identity: SshHostKeyTrustIdentity,
	options: {
		store?: SshHostKeyTrustStore;
		policy?: SshHostKeyTrustPolicy;
		onFailure?: (error: SshHostKeyTrustError) => void;
	} = {}
): Pick<ConnectConfig, 'hostHash' | 'hostVerifier'> {
	const store = options.store ?? getDefaultTrustStore();
	const policy = options.policy ?? readSshHostKeyTrustPolicy();

	const hostVerifier = (fingerprint: string): boolean => {
		const result = verifySshHostKeyFingerprint(identity, String(fingerprint), store, policy);
		if (!result.ok) options.onFailure?.(result.error);
		return result.ok;
	};

	return {
		hostHash: hostKeyHash,
		hostVerifier
	};
}

export function verifySshHostKeyFingerprint(
	identity: SshHostKeyTrustIdentity,
	fingerprint: string,
	store: SshHostKeyTrustStore,
	policy: SshHostKeyTrustPolicy,
	now = new Date()
): { ok: true; pin: SshHostKeyPin } | { ok: false; error: SshHostKeyTrustError } {
	const normalizedFingerprint = normalizeFingerprint(fingerprint);
	let pinned: SshHostKeyPin | null;

	try {
		pinned = store.get(identity);
	} catch (error) {
		return verificationFailure(error, 'SSH host key trust store could not be read');
	}

	if (pinned) {
		if (pinned.fingerprint !== normalizedFingerprint) {
			return {
				ok: false,
				error: new SshHostKeyTrustError(
					`SSH host key mismatch for ${identity.hostname}:${identity.port}; refusing to submit credentials`
				)
			};
		}

		const pin = { ...pinned, lastSeenAt: now.toISOString() };
		try {
			store.set(identity, pin);
		} catch {
			return { ok: true, pin: pinned };
		}
		return { ok: true, pin };
	}

	if (!policy.trustOnFirstUse) {
		return {
			ok: false,
			error: new SshHostKeyTrustError(unknownHostKeyMessage(identity, policy))
		};
	}

	const pin: SshHostKeyPin = {
		fingerprint: normalizedFingerprint,
		hostname: identity.hostname,
		port: identity.port,
		firstSeenAt: now.toISOString(),
		lastSeenAt: now.toISOString(),
		trust: 'tofu'
	};

	try {
		store.set(identity, pin);
	} catch (error) {
		return verificationFailure(error, 'SSH host key trust store could not be written');
	}

	return { ok: true, pin };
}

export function readSshHostKeyTrustPolicy(
	environment: SshHostKeyTrustEnvironment = env
): SshHostKeyTrustPolicy {
	const tofuRequested = !isDisabled(environment.TERMIXKIT_SSH_TRUST_ON_FIRST_USE);
	const productionTofuBlocked =
		tofuRequested &&
		environment.NODE_ENV === 'production' &&
		isDisabled(environment.TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU);

	return {
		trustOnFirstUse: tofuRequested && !productionTofuBlocked,
		productionTofuBlocked
	};
}

export function getSshHostKeyPin(
	identity: SshHostKeyTrustIdentity,
	store: SshHostKeyTrustStore = getDefaultTrustStore()
): SshHostKeyPin | null {
	return store.get(identity);
}

export function getDefaultSshHostKeyTrustStore(): SshHostKeyTrustStore {
	return getDefaultTrustStore();
}

function getDefaultTrustStore(): SshHostKeyTrustStore {
	defaultTrustStore ??= new JsonFileSshHostKeyTrustStore();
	return defaultTrustStore;
}

function defaultKnownHostsPath(): string {
	return (
		env.TERMIXKIT_SSH_KNOWN_HOSTS_PATH ??
		join(
			env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
			'termixkit',
			'ssh-known-hosts.json'
		)
	);
}

function isDisabled(value: string | undefined): boolean {
	return value === '0' || value?.toLowerCase() === 'false';
}

function normalizeFingerprint(fingerprint: string): string {
	return `sha256:${fingerprint.trim().toLowerCase()}`;
}

function unknownHostKeyMessage(
	identity: SshHostKeyTrustIdentity,
	policy: SshHostKeyTrustPolicy
): string {
	const prefix = `SSH host key is not pinned for ${identity.hostname}:${identity.port}; refusing to submit credentials`;
	if (policy.productionTofuBlocked) {
		return `${prefix}. TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU=0 blocks first-use enrollment in production; seed TERMIXKIT_SSH_KNOWN_HOSTS_PATH or remove the override.`;
	}
	return `${prefix}. Remove TERMIXKIT_SSH_TRUST_ON_FIRST_USE=0 or enroll the host key manually, then keep the resulting pin.`;
}

function verificationFailure(
	error: unknown,
	message: string
): { ok: false; error: SshHostKeyTrustError } {
	return {
		ok: false,
		error: new SshHostKeyTrustError(
			error instanceof Error ? `${message}: ${error.message}` : message
		)
	};
}

function identityKey(identity: SshHostKeyTrustIdentity): string {
	return [identity.userId, identity.hostId, identity.hostname.toLowerCase(), String(identity.port)]
		.map(encodeURIComponent)
		.join('|');
}

function emptyKnownHostsFile(): KnownHostsFile {
	return { version: knownHostsFileVersion, pins: {} };
}

type KnownHostsFile = {
	version: typeof knownHostsFileVersion;
	pins: Record<string, SshHostKeyPin>;
};

function isKnownHostsFile(value: unknown): value is KnownHostsFile {
	if (!isRecord(value) || value.version !== knownHostsFileVersion || !isRecord(value.pins)) {
		return false;
	}

	return Object.values(value.pins).every(isSshHostKeyPin);
}

function isSshHostKeyPin(value: unknown): value is SshHostKeyPin {
	return (
		isRecord(value) &&
		typeof value.fingerprint === 'string' &&
		typeof value.hostname === 'string' &&
		typeof value.port === 'number' &&
		typeof value.firstSeenAt === 'string' &&
		typeof value.lastSeenAt === 'string' &&
		(value.trust === 'pinned' || value.trust === 'tofu')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
