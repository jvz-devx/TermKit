import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialEncryptionError } from '$lib/server/crypto/credentials';
import { HostService } from '$lib/server/services/hosts';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import { SessionTicketService } from '$lib/server/services/session-tickets';
import { SshLiveSessionService } from '$lib/server/services/ssh-live-sessions';
import type { CredentialCrypto, EncryptionMetadata } from '$lib/server/services/types';
import { LiveSshAttachTicketConsumer, SessionTicketConsumer } from './ticket-consumer';

afterEach(() => {
	vi.useRealTimers();
});

describe('SessionTicketConsumer', () => {
	it('does not consume tickets for a different authenticated user', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh'
		});
		const consumer = new SessionTicketConsumer(tickets, hosts, repository, passthroughCrypto());

		await expect(consumer.consume(created.ticket, 'ssh', 'user-2')).resolves.toBeNull();
		await expect(tickets.consume(created.ticket)).resolves.toMatchObject({
			id: created.record.id
		});
	});

	it('does not consume tickets when credential decryption fails', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		const crypto: CredentialCrypto = failingDecryptCrypto();
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Shell password',
			kind: 'password',
			username: 'credential-user',
			encryptedSecret: 'encrypted-password',
			encryption: testEncryptionMetadata(),
			metadata: {},
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			credentialId: 'credential-1'
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh'
		});
		const consumer = new SessionTicketConsumer(tickets, hosts, repository, crypto);

		await expect(consumer.consume(created.ticket, 'ssh')).rejects.toThrow(
			'Credential secret could not be decrypted'
		);
		await expect(tickets.consume(created.ticket)).resolves.toMatchObject({
			id: created.record.id
		});
	});

	it('passes host metadata to protocol adapters with credential references', async () => {
		expect.assertions(1);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'RDP password',
			kind: 'password',
			username: 'credential-user',
			encryptedSecret: 'encrypted-password',
			encryption: testEncryptionMetadata(),
			metadata: {},
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const host = await hosts.create('user-1', {
			name: 'Windows admin',
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389,
			credentialId: 'credential-1',
			metadata: { domain: 'ACME' }
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'rdp'
		});
		const consumer = new SessionTicketConsumer(tickets, hosts, repository, passthroughCrypto());

		await expect(consumer.consume(created.ticket, 'rdp', 'user-1')).resolves.toMatchObject({
			metadata: {
				domain: 'ACME',
				credentialId: 'credential-1'
			}
		});
	});

	it('decrypts SSH key credentials and encrypted passphrases before consuming tickets', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Shell key',
			kind: 'ssh_key',
			username: 'key-user',
			encryptedSecret: 'encrypted-key',
			encryption: testEncryptionMetadata(),
			metadata: {
				encryptedPassphrase: {
					ciphertext: 'encrypted-passphrase',
					encryption: testEncryptionMetadata()
				}
			},
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			credentialId: 'credential-1'
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh'
		});
		const consumer = new SessionTicketConsumer(tickets, hosts, repository, passthroughCrypto());

		await expect(consumer.consume(created.ticket, 'ssh', 'user-1')).resolves.toMatchObject({
			target: {
				username: 'key-user',
				credential: {
					kind: 'ssh_key',
					username: 'key-user',
					privateKey: 'encrypted-key',
					passphrase: 'encrypted-passphrase'
				}
			},
			metadata: { credentialId: 'credential-1' }
		});
		await expect(tickets.consume(created.ticket)).rejects.toMatchObject({
			name: 'TicketConsumedError'
		});
	});

	it('returns null for already consumed session tickets', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh'
		});
		const consumer = new SessionTicketConsumer(tickets, hosts, repository, passthroughCrypto());

		await expect(consumer.consume(created.ticket, 'ssh', 'user-1')).resolves.toMatchObject({
			ticketId: created.record.id
		});
		await expect(consumer.consume(created.ticket, 'ssh', 'user-1')).resolves.toBeNull();
	});
});

describe('LiveSshAttachTicketConsumer', () => {
	it('consumes attach tickets into live SSH attach context with credentials and jump metadata', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const liveSessions = new SshLiveSessionService(repository, hosts, repository);
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Shell password',
			kind: 'password',
			username: 'credential-user',
			encryptedSecret: 'encrypted-password',
			encryption: testEncryptionMetadata(),
			metadata: {},
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			username: 'host-user',
			credentialId: 'credential-1',
			metadata: { sshJumpHost: { enabled: true, hostId: 'jump-host-1' } }
		});
		const { session } = await liveSessions.createOrReuse('user-1', {
			hostId: host.id,
			terminalCols: 132,
			terminalRows: 43
		});
		const attachTicket = await liveSessions.createAttachTicket(
			'user-1',
			session.id,
			new Date(),
			5_000
		);
		const consumer = new LiveSshAttachTicketConsumer(
			liveSessions,
			hosts,
			repository,
			passthroughCrypto()
		);

		await expect(consumer.consume(attachTicket.ticket, 'user-1')).resolves.toMatchObject({
			userId: 'user-1',
			sshLiveSessionId: session.id,
			terminalCols: 132,
			terminalRows: 43,
			session: {
				ticketId: session.id,
				userId: 'user-1',
				hostId: host.id,
				protocol: 'ssh',
				target: {
					host: 'shell.example.test',
					port: 22,
					username: 'host-user',
					credential: {
						kind: 'password',
						username: 'credential-user',
						password: 'encrypted-password'
					},
					jumpHost: { hostId: 'jump-host-1' }
				},
				metadata: {
					credentialId: 'credential-1',
					sshJumpHost: { enabled: true, hostId: 'jump-host-1' }
				}
			}
		});
		await expect(consumer.consume(attachTicket.ticket, 'user-1')).resolves.toBeNull();
	});

	it('returns null for expired attach tickets and leaves them unconsumed', async () => {
		expect.assertions(3);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const liveSessions = new SshLiveSessionService(repository, hosts, repository);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const { session } = await liveSessions.createOrReuse('user-1', {
			hostId: host.id,
			now: new Date('2026-05-13T12:00:00.000Z')
		});
		const attachTicket = await liveSessions.createAttachTicket(
			'user-1',
			session.id,
			new Date('2026-05-13T12:00:00.000Z'),
			1_000
		);
		const consumer = new LiveSshAttachTicketConsumer(
			liveSessions,
			hosts,
			repository,
			passthroughCrypto()
		);

		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-13T12:00:02.000Z'));
		await expect(consumer.consume(attachTicket.ticket, 'user-1')).resolves.toBeNull();
		await expect(
			repository.getSshAttachTicketByHash(attachTicket.record.ticketHash)
		).resolves.toMatchObject({
			consumedAt: null
		});
		await expect(repository.getSshLiveSession('user-1', session.id)).resolves.toMatchObject({
			status: 'ended'
		});
		vi.useRealTimers();
	});
});

function passthroughCrypto(): CredentialCrypto {
	return {
		encrypt() {
			throw new Error('encrypt is not used in ticket consumer tests');
		},
		decrypt(secret) {
			return secret.ciphertext;
		}
	};
}

function failingDecryptCrypto(): CredentialCrypto {
	return {
		encrypt() {
			throw new Error('encrypt is not used in ticket consumer tests');
		},
		decrypt() {
			throw new CredentialEncryptionError(
				'Credential secret could not be decrypted; verify CREDENTIAL_MASTER_KEY, encryption context, and stored metadata'
			);
		}
	};
}

function testEncryptionMetadata(): EncryptionMetadata {
	return {
		algorithm: 'aes-256-gcm',
		keyVersion: 1,
		iv: 'iv',
		authTag: 'auth-tag',
		salt: 'salt'
	};
}
