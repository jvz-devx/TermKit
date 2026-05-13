import { describe, expect, it } from 'vitest';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { SessionTicketService } from '../session-tickets';
import { TicketConsumedError, TicketExpiredError, TicketInvalidError } from '../errors';

describe('SessionTicketService', () => {
	it('creates short-lived tickets and consumes them once', async () => {
		expect.assertions(5);

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
			protocol: 'ssh',
			target: 'ssh:shell.example.test:22'
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
});
