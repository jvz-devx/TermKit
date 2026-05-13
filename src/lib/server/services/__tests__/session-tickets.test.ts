import { describe, expect, it } from 'vitest';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { parseSessionTicketTargetSnapshot, SessionTicketService } from '../session-tickets';
import { TicketConsumedError, TicketExpiredError, TicketInvalidError } from '../errors';

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

	it('rejects expired tickets without consuming them', async () => {
		expect.assertions(2);

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
		await expect(
			tickets.consume(created.ticket, new Date('2026-05-13T12:00:00.500Z'))
		).resolves.toMatchObject({ usedAt: new Date('2026-05-13T12:00:00.500Z') });
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
			protocol: 'ssh'
		});

		await expect(
			tickets.consume(created.ticket, new Date(), undefined, 'vnc')
		).rejects.toBeInstanceOf(TicketInvalidError);
		await expect(
			tickets.consume(created.ticket, new Date(), undefined, 'ssh')
		).resolves.toMatchObject({
			hostId: host.id,
			protocol: 'ssh'
		});
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

		expect(snapshot.host.metadata).toEqual({ domain: 'ACME' });
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
});

function testEncryptionMetadata() {
	return {
		algorithm: 'aes-256-gcm' as const,
		keyVersion: 1,
		iv: 'iv',
		authTag: 'auth-tag',
		salt: 'salt'
	};
}
