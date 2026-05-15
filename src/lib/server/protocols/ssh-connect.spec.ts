import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { ServiceValidationError } from '$lib/server/services/errors';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { HostRecord } from '$lib/server/services/types';
import { connectTrustedSsh, _resolveJumpHostTarget, type SshConnectTarget } from './ssh-connect';

const ssh2Mocks = vi.hoisted(() => {
	type Listener = (...args: unknown[]) => void;

	class MockClient {
		private readonly listeners = new Map<string, Listener[]>();
		connect = vi.fn();
		end = vi.fn();
		forwardOut = vi.fn(
			(
				_sourceHost: string,
				_sourcePort: number,
				_targetHost: string,
				_targetPort: number,
				callback: (error: Error | undefined, channel?: unknown) => void
			) => callback(undefined, mockChannel())
		);

		on(event: string, listener: Listener) {
			this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
			return this;
		}

		once(event: string, listener: Listener) {
			const wrapper: Listener & { original?: Listener } = ((...args: never[]) => {
				this.off(event, wrapper);
				listener(...args);
			}) as Listener & { original?: Listener };
			wrapper.original = listener;
			return this.on(event, wrapper);
		}

		off(event: string, listener: Listener) {
			this.listeners.set(
				event,
				(this.listeners.get(event) ?? []).filter(
					(candidate) =>
						candidate !== listener &&
						(candidate as Listener & { original?: Listener }).original !== listener
				)
			);
			return this;
		}

		emit(event: string, ...args: unknown[]) {
			for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
			return this.listeners.has(event);
		}

		listenerCount(event: string) {
			return this.listeners.get(event)?.length ?? 0;
		}
	}

	const clients: MockClient[] = [];
	const mockChannel = () => ({ destroyed: false });

	return {
		clients,
		MockClient: class extends MockClient {
			constructor() {
				super();
				clients.push(this);
			}
		},
		reset() {
			clients.length = 0;
		}
	};
});

vi.mock('ssh2', () => ({
	Client: ssh2Mocks.MockClient
}));

describe('SSH jump-host target resolution', () => {
	beforeEach(() => {
		ssh2Mocks.reset();
	});

	it('requires an explicit jump host target', async () => {
		await expect(_resolveJumpHostTarget(target())).rejects.toMatchObject({
			issues: ['SSH jump host is required']
		});
	});

	it('resolves jump host credentials through the same credential model as final targets', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const crypto = new AesGcmCredentialCrypto('ssh-connect-test-key');
		const credentials = new CredentialService(repository, crypto);
		const credential = await credentials.create('user-1', {
			name: 'Jump key',
			kind: 'ssh_key',
			username: 'bastion-user',
			secret: 'private-key',
			metadata: { passphrase: 'jump-passphrase' }
		});
		await repository.createHost(
			host({
				id: 'jump-1',
				name: 'Bastion',
				hostname: 'jump.example.test',
				credentialId: credential.id
			})
		);

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), {
				repository,
				crypto
			})
		).resolves.toMatchObject({
			userId: 'user-1',
			hostId: 'jump-1',
			host: 'jump.example.test',
			port: 22,
			username: 'bastion-user',
			credential: {
				kind: 'ssh_key',
				username: 'bastion-user',
				privateKey: 'private-key',
				passphrase: 'jump-passphrase'
			}
		});
	});

	it('resolves jump hosts with host usernames and keeps nested jump metadata', async () => {
		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(
			host({
				id: 'jump-1',
				username: 'bastion-host-user',
				hostname: 'jump.example.test',
				metadata: { sshJumpHost: { enabled: true, hostId: 'outer-jump' } }
			})
		);

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), { repository })
		).resolves.toMatchObject({
			userId: 'user-1',
			hostId: 'jump-1',
			host: 'jump.example.test',
			port: 22,
			username: 'bastion-host-user',
			credential: undefined,
			jumpHost: { hostId: 'outer-jump' }
		});
	});

	it('rejects non-SSH jump hosts before opening a connection', async () => {
		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(
			host({
				id: 'jump-1',
				protocol: 'rdp',
				name: 'Wrong protocol',
				hostname: 'windows.example.test',
				port: 3389,
				username: 'admin'
			})
		);

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), { repository })
		).rejects.toBeInstanceOf(ServiceValidationError);
	});

	it('rejects missing jump hosts, missing credentials, and username-less jump hosts', async () => {
		const missing = new InMemoryTermixServicesRepository();

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), { repository: missing })
		).rejects.toMatchObject({ message: 'SSH jump host not found' });

		const missingCredential = new InMemoryTermixServicesRepository();
		await missingCredential.createHost(host({ id: 'jump-1', credentialId: 'credential-404' }));

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), {
				repository: missingCredential
			})
		).rejects.toMatchObject({ message: 'SSH jump credential not found' });

		const missingUsername = new InMemoryTermixServicesRepository();
		await missingUsername.createHost(host({ id: 'jump-1' }));

		await expect(
			_resolveJumpHostTarget(target({ jumpHost: { hostId: 'jump-1' } }), {
				repository: missingUsername
			})
		).rejects.toMatchObject({ issues: ['SSH jump host username is required'] });
	});
});

describe('trusted SSH connection cleanup', () => {
	beforeEach(() => {
		ssh2Mocks.reset();
	});

	it('removes direct connection listeners after a connection error', async () => {
		expect.assertions(4);

		const connecting = connectTrustedSsh(target({ username: 'ops' }));
		const connection = ssh2Mocks.clients[0];

		expect(connection.listenerCount('ready')).toBe(1);
		expect(connection.listenerCount('error')).toBe(1);
		connection.emit('error', new Error('authentication failed') as never);

		await expect(connecting).rejects.toThrow('authentication failed');
		expect(connection.listenerCount('ready') + connection.listenerCount('error')).toBe(0);
	});

	it('closes the jump connection when opening the forwarded channel fails', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(
			host({
				id: 'jump-1',
				username: 'bastion-user',
				hostname: 'jump.example.test'
			})
		);
		const connecting = connectTrustedSsh(target({ jumpHost: { hostId: 'jump-1' } }), {
			repository
		});
		await waitForMockClient(0);
		const jumpConnection = ssh2Mocks.clients[0];
		jumpConnection.forwardOut.mockImplementationOnce(
			(
				_sourceHost: string,
				_sourcePort: number,
				_targetHost: string,
				_targetPort: number,
				callback: (error: Error) => void
			) => callback(new Error('forward refused'))
		);

		jumpConnection.emit('ready');

		await expect(connecting).rejects.toThrow('forward refused');
		expect(jumpConnection.end).toHaveBeenCalledTimes(1);
	});

	it('closes the jump connection when the target connection fails after forwarding', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(
			host({
				id: 'jump-1',
				username: 'bastion-user',
				hostname: 'jump.example.test'
			})
		);
		const connecting = connectTrustedSsh(target({ jumpHost: { hostId: 'jump-1' } }), {
			repository
		});
		await waitForMockClient(0);
		const jumpConnection = ssh2Mocks.clients[0];

		jumpConnection.emit('ready');
		await waitForMockClient(1);
		const targetConnection = ssh2Mocks.clients[1];
		targetConnection.emit('error', new Error('target refused') as never);

		await expect(connecting).rejects.toThrow('target refused');
		expect(jumpConnection.end).toHaveBeenCalledTimes(1);
	});
});

function target(patch: Partial<SshConnectTarget> = {}): SshConnectTarget {
	return {
		userId: 'user-1',
		hostId: 'target-1',
		host: 'target.example.test',
		port: 22,
		username: 'ops',
		...patch
	};
}

function host(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'host-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'SSH host',
		protocol: 'ssh',
		hostname: 'shell.example.test',
		port: 22,
		username: null,
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

async function waitForMockClient(index: number): Promise<void> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		if (ssh2Mocks.clients[index]) return;
		await Promise.resolve();
	}
	throw new Error(`Timed out waiting for mock SSH client ${index}`);
}
