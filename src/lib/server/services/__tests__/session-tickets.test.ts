import { describe, expect, it } from 'vitest';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { parseSessionTicketTargetSnapshot, SessionTicketService } from '../session-tickets';
import { TicketConsumedError, TicketExpiredError, TicketInvalidError } from '../errors';
import type { SessionTicketRecord } from '../types';

describe('SessionTicketService', () => {
	it('creates short-lived tickets and consumes them once', async () => {
		expect.assertions(6);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
		const now = new Date('2026-05-13T12:00:00.000Z');
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});

		const input = {
			hostId: host.id,
			protocol: 'ssh',
			target: 'client-supplied-target',
			now,
			ttlMs: 10_000
		} as const;
		const created = await tickets.create('user-1', input);

		expect(created.ticket).toEqual(expect.any(String));
		expect(created.record.expiresAt).toEqual(new Date('2026-05-13T12:00:10.000Z'));

		const consumed = await tickets.consume(created.ticket, new Date('2026-05-13T12:00:01.000Z'));

		expect(consumed.usedAt).toEqual(new Date('2026-05-13T12:00:01.000Z'));
		await expect(
			tickets.consume(created.ticket, new Date('2026-05-13T12:00:02.000Z'))
		).rejects.toBeInstanceOf(TicketConsumedError);
		expect(consumed).toMatchObject({
			userId: 'user-1',
			hostId: host.id,
			protocol: 'ssh'
		});
		expect(parseSessionTicketTargetSnapshot(consumed)).toMatchObject({
			version: 1,
			host: {
				id: host.id,
				protocol: 'ssh',
				hostname: 'shell.example.test',
				port: 22,
				credentialId: null,
				metadata: {}
			},
			credential: null
		});
	});

	it('validates missing hosts, host ownership, unsupported protocols, and create-time protocol mismatches', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});

		await expect(tickets.create('user-1', { protocol: 'ssh' })).rejects.toMatchObject({
			issues: ['hostId is required']
		});
		await expect(
			tickets.create('user-2', {
				hostId: host.id,
				protocol: 'ssh'
			})
		).rejects.toMatchObject({
			issues: ['hostId must reference an existing host owned by the user']
		});
		await expect(
			tickets.create('user-1', {
				hostId: host.id,
				protocol: 'ftp'
			})
		).rejects.toMatchObject({
			issues: ['protocol must be ssh, rdp, vnc, or telnet']
		});
		await expect(
			tickets.create('user-1', {
				hostId: host.id,
				protocol: 'ftps'
			})
		).rejects.toMatchObject({
			issues: ['protocol must be ssh, rdp, vnc, or telnet']
		});
		await expect(
			tickets.create('user-1', {
				hostId: host.id,
				protocol: 'rdp'
			})
		).rejects.toMatchObject({
			issues: ['protocol must match the selected host']
		});
	});

	it('rejects expired tickets without consuming them', async () => {
		expect.assertions(3);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
		const host = await hosts.create('user-1', {
			name: 'VNC',
			protocol: 'vnc',
			hostname: 'vnc.example.test',
			port: 5900
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'vnc',
			now: new Date('2026-05-13T12:00:00.000Z'),
			ttlMs: 1_000
		});

		await expect(
			tickets.consume(created.ticket, new Date('2026-05-13T12:00:01.000Z'))
		).rejects.toBeInstanceOf(TicketExpiredError);
		await expect(repository.getTicketByHash(created.record.ticketHash)).resolves.toMatchObject({
			usedAt: null
		});
		await expect(
			tickets.consume(created.ticket, new Date('2026-05-13T12:00:00.500Z'))
		).resolves.toMatchObject({ usedAt: new Date('2026-05-13T12:00:00.500Z') });
	});

	it('rejects tickets scoped to another user before consuming them', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh',
			now: new Date('2026-05-13T12:00:00.000Z')
		});

		await expect(
			tickets.consume(created.ticket, new Date('2026-05-13T12:00:01.000Z'), 'user-2')
		).rejects.toBeInstanceOf(TicketInvalidError);
		await expect(repository.getTicketByHash(created.record.ticketHash)).resolves.toMatchObject({
			usedAt: null
		});
	});

	it('rejects tickets for hosts with unavailable credentials', async () => {
		expect.assertions(1);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		const now = new Date('2026-05-13T12:00:00.000Z');
		const host = await repository.createHost({
			id: 'host-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			username: null,
			credentialId: 'missing-credential',
			folder: null,
			tags: [],
			notes: null,
			metadata: {},
			createdAt: now,
			updatedAt: now
		});

		await expect(
			tickets.create('user-1', {
				hostId: host.id,
				protocol: 'ssh'
			})
		).rejects.toMatchObject({
			issues: ['host credential must reference an existing credential owned by the user']
		});
	});

	it('rejects protocol mismatches before consuming tickets', async () => {
		expect.assertions(3);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
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

		await expect(
			tickets.consume(created.ticket, new Date(), undefined, 'vnc')
		).rejects.toBeInstanceOf(TicketInvalidError);
		await expect(repository.getTicketByHash(created.record.ticketHash)).resolves.toMatchObject({
			usedAt: null
		});
		await expect(
			tickets.consume(created.ticket, new Date(), undefined, 'ssh')
		).resolves.toMatchObject({
			hostId: host.id,
			protocol: 'ssh'
		});
	});

	it('reports already-consumed and missing-row consume races as consumed tickets', async () => {
		expect.assertions(2);

		const consumedRepository = new InMemoryTermixServicesRepository();
		const consumedHosts = new HostService(consumedRepository);
		const consumedTickets = new SessionTicketService(consumedRepository, consumedHosts);
		const host = await consumedHosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const created = await consumedTickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh'
		});

		await consumedTickets.consume(created.ticket);
		await expect(consumedTickets.validateForConsume(created.ticket)).rejects.toBeInstanceOf(
			TicketConsumedError
		);

		const missingRowRepository = new ConsumeMissingRowRepository();
		const missingRowHosts = new HostService(missingRowRepository);
		const missingRowTickets = new SessionTicketService(missingRowRepository, missingRowHosts);
		const missingRowHost = await missingRowHosts.create('user-1', {
			name: 'VNC',
			protocol: 'vnc',
			hostname: 'vnc.example.test',
			port: 5900
		});
		const missingRowCreated = await missingRowTickets.create('user-1', {
			hostId: missingRowHost.id,
			protocol: 'vnc'
		});

		await expect(missingRowTickets.consume(missingRowCreated.ticket)).rejects.toBeInstanceOf(
			TicketConsumedError
		);
	});

	it('rejects tickets that expire while the repository is consuming them', async () => {
		expect.assertions(1);

		const repository = new ExpiringConsumeRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
		const host = await hosts.create('user-1', {
			name: 'RDP',
			protocol: 'rdp',
			hostname: 'rdp.example.test',
			port: 3389
		});
		const now = new Date('2026-05-13T12:00:00.000Z');
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'rdp',
			now,
			ttlMs: 10_000
		});

		await expect(
			tickets.consume(created.ticket, new Date('2026-05-13T12:00:01.000Z'))
		).rejects.toBeInstanceOf(TicketExpiredError);
	});

	it('propagates repository creation failures after validating the target host', async () => {
		expect.assertions(1);

		const repository = new CreateFailingRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});

		await expect(
			tickets.create('user-1', {
				hostId: host.id,
				protocol: 'ssh'
			})
		).rejects.toThrow('create failed');
	});

	it('rejects tickets when the host target changed before consumption', async () => {
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

		await hosts.update('user-1', host.id, { hostname: 'changed.example.test' });

		await expect(tickets.consume(created.ticket)).rejects.toBeInstanceOf(TicketInvalidError);
		await expect(
			tickets.consume(created.ticket, new Date(), undefined, 'ssh')
		).rejects.toBeInstanceOf(TicketInvalidError);
	});

	it('rejects tickets when imported host metadata changed before consumption', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		const host = await hosts.create('user-1', {
			name: 'Windows admin',
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389,
			metadata: { domain: 'ACME' }
		});
		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'rdp'
		});
		const snapshot = parseSessionTicketTargetSnapshot(created.record);

		await hosts.update('user-1', host.id, { metadata: { domain: 'LAB' } });

		expect(snapshot.host.metadata).toEqual(expect.objectContaining({ domain: 'ACME' }));
		await expect(tickets.consume(created.ticket)).rejects.toBeInstanceOf(TicketInvalidError);
	});

	it('rejects tickets when the bound credential changed before consumption', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		const now = new Date();
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
			createdAt: now,
			updatedAt: now
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
		const snapshot = parseSessionTicketTargetSnapshot(created.record);

		await repository.updateCredential('user-1', 'credential-1', {
			encryptedSecret: 'changed-password'
		});

		expect(snapshot.credential).toMatchObject({
			id: 'credential-1',
			fingerprint: expect.any(String)
		});
		await expect(tickets.consume(created.ticket)).rejects.toBeInstanceOf(TicketInvalidError);
	});

	it('snapshots credential identity without persisting decryptable credential material', async () => {
		expect.assertions(7);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts, repository);
		const now = new Date('2026-05-13T12:00:00.000Z');
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Shell password',
			kind: 'password',
			username: 'credential-user',
			encryptedSecret: 'encrypted-super-secret',
			encryption: {
				...testEncryptionMetadata(),
				authTag: 'sensitive-auth-tag',
				salt: 'sensitive-salt'
			},
			metadata: {
				encryptedPassphrase: {
					ciphertext: 'encrypted-passphrase',
					encryption: testEncryptionMetadata()
				}
			},
			createdAt: now,
			updatedAt: now
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
			protocol: 'ssh',
			now
		});
		const snapshot = parseSessionTicketTargetSnapshot(created.record);

		expect(snapshot.credential).toEqual({
			id: 'credential-1',
			kind: 'password',
			username: 'credential-user',
			fingerprint: expect.any(String)
		});
		expect(created.record.target).not.toContain('encrypted-super-secret');
		expect(created.record.target).not.toContain('sensitive-auth-tag');
		expect(created.record.target).not.toContain('sensitive-salt');
		expect(created.record.target).not.toContain('encrypted-passphrase');
		expect(created.record.target).not.toContain('passwordHash');
		expect(created.record.ticketHash).not.toBe(created.ticket);
	});

	it('snapshots host metadata without exposing non-target host fields', async () => {
		expect.assertions(6);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const tickets = new SessionTicketService(repository, hosts);
		const host = await hosts.create('user-1', {
			name: 'Imported shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			username: 'shell-user',
			folder: 'Production',
			tags: ['prod', 'ssh'],
			notes: 'operator-only notes',
			metadata: {
				source: {
					provider: 'microsoft',
					tenantId: 'tenant-1'
				},
				terminalPreferences: {
					scrollback: 10_000
				}
			}
		});

		const created = await tickets.create('user-1', {
			hostId: host.id,
			protocol: 'ssh',
			now: new Date('2026-05-13T12:00:00.000Z')
		});
		const snapshot = parseSessionTicketTargetSnapshot(created.record);

		expect(snapshot.host).toMatchObject({
			id: host.id,
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			username: 'shell-user',
			credentialId: null,
			metadata: expect.objectContaining({
				source: {
					provider: 'microsoft',
					tenantId: 'tenant-1'
				},
				terminalPreferences: expect.objectContaining({
					scrollback: 10_000
				})
			})
		});
		expect(created.record.target).not.toContain('Imported shell');
		expect(created.record.target).not.toContain('Production');
		expect(created.record.target).not.toContain('prod');
		expect(created.record.target).not.toContain('operator-only notes');
		await expect(
			tickets.consume(created.ticket, new Date('2026-05-13T12:00:01.000Z'))
		).resolves.toMatchObject({ hostId: host.id });
	});

	it('rejects missing and malformed target snapshots from repository rows', () => {
		const baseRecord = {
			id: 'ticket-1',
			ticketHash: 'ticket-hash',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh' as const,
			expiresAt: new Date('2026-05-13T12:01:00.000Z'),
			usedAt: null,
			createdAt: new Date('2026-05-13T12:00:00.000Z')
		};

		expect(() => parseSessionTicketTargetSnapshot(baseRecord)).toThrow(TicketInvalidError);
		expect(() => parseSessionTicketTargetSnapshot({ ...baseRecord, target: '{' })).toThrow(
			TicketInvalidError
		);
		expect(() =>
			parseSessionTicketTargetSnapshot({
				...baseRecord,
				target: JSON.stringify({
					version: 1,
					host: {
						id: 'host-1',
						protocol: 'ssh',
						hostname: 'shell.example.test',
						port: 22,
						username: null,
						credentialId: null,
						metadata: []
					},
					credential: null
				})
			})
		).toThrow(TicketInvalidError);
	});
});

class ConsumeMissingRowRepository extends InMemoryTermixServicesRepository {
	override async consumeTicket(): Promise<SessionTicketRecord | null> {
		return null;
	}
}

class ExpiringConsumeRepository extends InMemoryTermixServicesRepository {
	override async consumeTicket(
		ticketHash: string,
		usedAt: Date
	): Promise<SessionTicketRecord | null> {
		const consumed = await super.consumeTicket(ticketHash, usedAt);
		return consumed ? { ...consumed, expiresAt: usedAt } : null;
	}
}

class CreateFailingRepository extends InMemoryTermixServicesRepository {
	override async createTicket(): Promise<SessionTicketRecord> {
		throw new Error('create failed');
	}
}

function testEncryptionMetadata() {
	return {
		algorithm: 'aes-256-gcm' as const,
		keyVersion: 1,
		iv: 'iv',
		authTag: 'auth-tag',
		salt: 'salt'
	};
}
