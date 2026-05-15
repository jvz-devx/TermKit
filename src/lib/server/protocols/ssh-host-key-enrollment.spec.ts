import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	enrollSshHostKey,
	summarizeSshHostKeyTrust,
	type SshHostKeyTrustSummary
} from './ssh-host-key-enrollment';
import { InMemorySshHostKeyTrustStore, type SshHostKeyTrustIdentity } from './ssh-host-trust';

const sftpMocks = vi.hoisted(() => ({
	resolveSftpTarget: vi.fn()
}));

vi.mock('./sftp', () => ({
	resolveSftpTarget: sftpMocks.resolveSftpTarget
}));

const identity: SshHostKeyTrustIdentity = {
	userId: 'user-1',
	hostId: 'host-1',
	hostname: 'shell.example.test',
	port: 22
};

beforeEach(() => {
	sftpMocks.resolveSftpTarget.mockReset();
	sftpMocks.resolveSftpTarget.mockResolvedValue(target());
});

describe('SSH host key enrollment summaries', () => {
	it('summarizes unknown hosts with production TOFU warnings', () => {
		expect.assertions(1);

		const summary = summarizeSshHostKeyTrust(target(), {
			store: new InMemorySshHostKeyTrustStore(),
			policy: { trustOnFirstUse: false, productionTofuBlocked: true }
		});

		expect(summary).toMatchObject({
			hostId: 'host-1',
			status: 'unknown',
			fingerprint: null,
			trustOnFirstUse: false,
			productionTofuBlocked: true,
			message: 'Automatic first-use enrollment is blocked in production.'
		} satisfies Partial<SshHostKeyTrustSummary>);
	});

	it('returns existing pins without opening an SSH enrollment connection', async () => {
		expect.assertions(3);

		const store = new InMemorySshHostKeyTrustStore();
		store.set(identity, {
			fingerprint: 'sha256:abc123',
			hostname: 'shell.example.test',
			port: 22,
			firstSeenAt: '2026-05-13T10:00:00.000Z',
			lastSeenAt: '2026-05-13T10:00:00.000Z',
			trust: 'pinned'
		});
		const createClient = vi.fn(() => new FakeEnrollmentClient() as never);

		await expect(
			enrollSshHostKey('user-1', 'host-1', { store, createClient })
		).resolves.toMatchObject({
			status: 'pinned',
			fingerprint: 'sha256:abc123',
			trust: 'pinned'
		});
		expect(sftpMocks.resolveSftpTarget).toHaveBeenCalledWith('user-1', 'host-1');
		expect(createClient).not.toHaveBeenCalled();
	});

	it('treats a pinned host key as enrolled even when authentication fails afterward', async () => {
		expect.assertions(4);

		const store = new InMemorySshHostKeyTrustStore();
		const client = new FakeEnrollmentClient((config) => {
			const verifier = config.hostVerifier as (fingerprint: string) => boolean;
			expect(verifier('ABC123')).toBe(true);
			client.emit('error', new Error('authentication failed'));
		});

		await expect(
			enrollSshHostKey('user-1', 'host-1', {
				store,
				createClient: () => client as never
			})
		).resolves.toMatchObject({
			status: 'pinned',
			fingerprint: 'sha256:abc123',
			trust: 'tofu'
		});
		expect(store.get(identity)).toMatchObject({ fingerprint: 'sha256:abc123' });
		expect(client.end).toHaveBeenCalledTimes(1);
	});

	it('rejects with the host-key trust error when enrollment verification fails', async () => {
		expect.assertions(3);

		const store = {
			get: () => null,
			set: () => {
				throw new Error('read-only');
			}
		};
		const client = new FakeEnrollmentClient((config) => {
			const verifier = config.hostVerifier as (fingerprint: string) => boolean;
			expect(verifier('def456')).toBe(false);
			client.emit('error', new Error('handshake failed'));
		});

		await expect(
			enrollSshHostKey('user-1', 'host-1', {
				store,
				createClient: () => client as never
			})
		).rejects.toMatchObject({
			name: 'SshHostKeyTrustError',
			message: expect.stringContaining('SSH host key trust store could not be written')
		});
		expect(client.end).toHaveBeenCalledTimes(1);
	});

	it.each(['close', 'end'] as const)(
		'rejects when the enrollment connection emits %s before pinning a key',
		async (event) => {
			expect.assertions(3);

			const store = new InMemorySshHostKeyTrustStore();
			const client = new FakeEnrollmentClient(() => {
				client.emit(event);
			});

			await expect(
				enrollSshHostKey('user-1', 'host-1', {
					store,
					createClient: () => client as never
				})
			).rejects.toMatchObject({
				issues: ['SSH host key enrollment did not complete']
			});
			expect(store.get(identity)).toBeNull();
			expect(client.end).not.toHaveBeenCalled();
		}
	);
});

function target() {
	return {
		userId: 'user-1',
		hostId: 'host-1',
		host: 'shell.example.test',
		port: 22,
		username: 'ops'
	};
}

class FakeEnrollmentClient extends EventEmitter {
	end = vi.fn();

	constructor(private readonly onConnect?: (config: Record<string, unknown>) => void) {
		super();
	}

	connect(config: Record<string, unknown>) {
		this.onConnect?.(config);
	}
}
