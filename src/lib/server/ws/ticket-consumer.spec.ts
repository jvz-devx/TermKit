import { describe, expect, it } from 'vitest';
import { CredentialEncryptionError } from '$lib/server/crypto/credentials';
import { HostService } from '$lib/server/services/hosts';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import { SessionTicketService } from '$lib/server/services/session-tickets';
import type { CredentialCrypto, EncryptionMetadata } from '$lib/server/services/types';
import { SessionTicketConsumer } from './ticket-consumer';

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
