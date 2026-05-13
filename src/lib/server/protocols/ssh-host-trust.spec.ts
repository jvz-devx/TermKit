import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createSshHostKeyVerifier,
	InMemorySshHostKeyTrustStore,
	JsonFileSshHostKeyTrustStore,
	readSshHostKeyTrustPolicy,
	verifySshHostKeyFingerprint,
	type SshHostKeyTrustIdentity,
	type SshHostKeyTrustPolicy
} from './ssh-host-trust';

const identity: SshHostKeyTrustIdentity = {
	userId: 'user-1',
	hostId: 'host-1',
	hostname: 'shell.example.test',
	port: 22
};

const strictPolicy: SshHostKeyTrustPolicy = {
	trustOnFirstUse: false,
	productionTofuBlocked: false
};

const tofuPolicy: SshHostKeyTrustPolicy = {
	trustOnFirstUse: true,
	productionTofuBlocked: false
};

let tempDirectory: string | undefined;

afterEach(() => {
	if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
	tempDirectory = undefined;
});

describe('SSH host key trust', () => {
	it('rejects unknown host keys before credentials can be submitted', () => {
		const store = new InMemorySshHostKeyTrustStore();

		const result = verifySshHostKeyFingerprint(identity, 'abc123', store, strictPolicy);

		expect(result).toMatchObject({
			ok: false,
			error: {
				message: expect.stringContaining('refusing to submit credentials')
			}
		});
		expect(store.get(identity)).toBeNull();
	});

	it('pins first-use fingerprints only when TOFU is explicitly enabled', () => {
		const store = new InMemorySshHostKeyTrustStore();
		const first = verifySshHostKeyFingerprint(
			identity,
			'ABC123',
			store,
			tofuPolicy,
			new Date('2026-05-13T10:00:00.000Z')
		);
		const second = verifySshHostKeyFingerprint(
			identity,
			'abc123',
			store,
			strictPolicy,
			new Date('2026-05-13T10:05:00.000Z')
		);

		expect(first).toMatchObject({
			ok: true,
			pin: {
				fingerprint: 'sha256:abc123',
				firstSeenAt: '2026-05-13T10:00:00.000Z'
			}
		});
		expect(second).toMatchObject({
			ok: true,
			pin: {
				fingerprint: 'sha256:abc123',
				firstSeenAt: '2026-05-13T10:00:00.000Z',
				lastSeenAt: '2026-05-13T10:05:00.000Z'
			}
		});
	});

	it('rejects changed host keys without replacing the pinned fingerprint', () => {
		const store = new InMemorySshHostKeyTrustStore();
		verifySshHostKeyFingerprint(identity, 'abc123', store, tofuPolicy);

		const result = verifySshHostKeyFingerprint(identity, 'def456', store, tofuPolicy);

		expect(result).toMatchObject({
			ok: false,
			error: {
				message: expect.stringContaining('SSH host key mismatch')
			}
		});
		expect(store.get(identity)).toMatchObject({ fingerprint: 'sha256:abc123' });
	});

	it('blocks production TOFU unless the production override is set', () => {
		expect(
			readSshHostKeyTrustPolicy({
				NODE_ENV: 'production',
				TERMIXKIT_SSH_TRUST_ON_FIRST_USE: '1'
			})
		).toEqual({
			trustOnFirstUse: false,
			productionTofuBlocked: true
		});
		expect(
			readSshHostKeyTrustPolicy({
				NODE_ENV: 'production',
				TERMIXKIT_SSH_TRUST_ON_FIRST_USE: '1',
				TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU: '1'
			})
		).toEqual({
			trustOnFirstUse: true,
			productionTofuBlocked: false
		});
	});

	it('writes pinned fingerprints to the known-hosts file', () => {
		tempDirectory = mkdtempSync(join(tmpdir(), 'termixkit-ssh-host-trust-'));
		const path = join(tempDirectory, 'known-hosts.json');
		const store = new JsonFileSshHostKeyTrustStore(path);

		const result = verifySshHostKeyFingerprint(identity, 'abc123', store, tofuPolicy);
		const file = JSON.parse(readFileSync(path, 'utf8')) as {
			version: number;
			pins: Record<string, { fingerprint: string }>;
		};

		expect(result).toMatchObject({ ok: true });
		expect(file.version).toBe(1);
		expect(Object.keys(file.pins)).toEqual(['user-1|host-1|shell.example.test|22']);
		expect(Object.values(file.pins)).toEqual([
			expect.objectContaining({ fingerprint: 'sha256:abc123' })
		]);
	});

	it('builds an ssh2 verifier that uses SHA-256 host-key hashes', () => {
		const store = new InMemorySshHostKeyTrustStore();
		let failure: Error | undefined;
		const verifier = createSshHostKeyVerifier(identity, {
			store,
			policy: strictPolicy,
			onFailure(error) {
				failure = error;
			}
		});

		expect(verifier.hostHash).toBe('sha256');
		const hostVerifier = verifier.hostVerifier as (fingerprint: string) => boolean;
		expect(hostVerifier('abc123')).toBe(false);
		expect(failure?.message).toContain('refusing to submit credentials');
	});
});
