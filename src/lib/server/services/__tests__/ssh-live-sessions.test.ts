import { describe, expect, it } from 'vitest';
import { TicketConsumedError, TicketExpiredError, TicketInvalidError } from '../errors';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { SshLiveSessionService } from '../ssh-live-sessions';

describe('SshLiveSessionService', () => {
	it('creates an SSH live session and reuses the open session for the same host', async () => {
		expect.assertions(6);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository);
		const host = await hosts.create('user-1', {
			name: 'Production shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});

		const created = await service.createOrReuse('user-1', {
			hostId: host.id,
			terminalCols: 120,
			terminalRows: 32,
			now: new Date('2026-05-13T12:00:00.000Z')
		});
		const reused = await service.createOrReuse('user-1', {
			hostId: host.id,
			title: 'Renamed tab',
			now: new Date('2026-05-13T12:00:01.000Z')
		});

		expect(created.reused).toBe(false);
		expect(created.session).toMatchObject({
			userId: 'user-1',
			hostId: host.id,
			title: 'Production shell',
			status: 'starting',
			terminalCols: 120,
			terminalRows: 32
		});
		expect(reused.reused).toBe(true);
		expect(reused.session.id).toBe(created.session.id);
		expect(reused.session.title).toBe('Renamed tab');
		await expect(service.list('user-1')).resolves.toHaveLength(1);
	});

	it('rejects non-SSH hosts and unavailable host credentials', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository);
		const rdpHost = await hosts.create('user-1', {
			name: 'Windows',
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389
		});
		const sshHostWithMissingCredential = await repository.createHost({
			id: 'host-with-missing-credential',
			userId: 'user-1',
			name: 'Broken shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22,
			username: null,
			credentialId: 'missing-credential',
			folder: null,
			tags: [],
			notes: null,
			metadata: {},
			createdAt: new Date(),
			updatedAt: new Date()
		});

		await expect(service.createOrReuse('user-1', { hostId: rdpHost.id })).rejects.toMatchObject({
			issues: ['hostId must reference an SSH host']
		});
		await expect(
			service.createOrReuse('user-1', { hostId: sshHostWithMissingCredential.id })
		).rejects.toMatchObject({
			issues: ['host credential must reference an existing credential owned by the user']
		});
	});

	it('renames sessions and records attach/detach idle metadata', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			detachedIdleTtlMs: 5_000
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const { session } = await service.createOrReuse('user-1', { hostId: host.id });
		const attachedAt = new Date('2026-05-13T12:00:00.000Z');
		const detachedAt = new Date('2026-05-13T12:00:10.000Z');

		await expect(service.rename('user-1', session.id, 'Ops shell')).resolves.toMatchObject({
			title: 'Ops shell'
		});
		await expect(
			service.markAttached(
				'user-1',
				session.id,
				{ terminalCols: 132, terminalRows: 40 },
				attachedAt
			)
		).resolves.toMatchObject({
			status: 'attached',
			lastAttachedAt: attachedAt,
			detachedAt: null,
			expiresAt: null
		});

		const detached = await service.markDetached('user-1', session.id, detachedAt);

		expect(detached.status).toBe('detached');
		expect(detached.detachedAt).toEqual(detachedAt);
		expect(detached.expiresAt).toEqual(new Date('2026-05-13T12:00:15.000Z'));
	});

	it('creates and consumes single-use attach tickets', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const { session } = await service.createOrReuse('user-1', { hostId: host.id });
		const created = await service.createAttachTicket(
			'user-1',
			session.id,
			new Date('2026-05-13T12:00:00.000Z'),
			5_000
		);

		expect(created.ticket).toEqual(expect.any(String));
		expect(created.record).toMatchObject({
			userId: 'user-1',
			sshLiveSessionId: session.id,
			consumedAt: null,
			expiresAt: new Date('2026-05-13T12:00:05.000Z')
		});
		await expect(
			service.consumeAttachTicket(created.ticket, new Date('2026-05-13T12:00:01.000Z'), 'user-1')
		).resolves.toMatchObject({
			userId: 'user-1',
			sshLiveSessionId: session.id,
			consumedAt: new Date('2026-05-13T12:00:01.000Z')
		});
		await expect(
			service.consumeAttachTicket(created.ticket, new Date('2026-05-13T12:00:02.000Z'), 'user-1')
		).rejects.toBeInstanceOf(TicketConsumedError);
		await expect(
			service.consumeAttachTicket(created.ticket, new Date('2026-05-13T12:00:02.000Z'), 'user-2')
		).rejects.toBeInstanceOf(TicketInvalidError);
	});

	it('rejects expired attach tickets without consuming them', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository);
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const { session } = await service.createOrReuse('user-1', { hostId: host.id });
		const created = await service.createAttachTicket(
			'user-1',
			session.id,
			new Date('2026-05-13T12:00:00.000Z'),
			1_000
		);

		await expect(
			service.consumeAttachTicket(created.ticket, new Date('2026-05-13T12:00:01.000Z'))
		).rejects.toBeInstanceOf(TicketExpiredError);
		await expect(
			service.consumeAttachTicket(created.ticket, new Date('2026-05-13T12:00:00.500Z'))
		).resolves.toMatchObject({ consumedAt: new Date('2026-05-13T12:00:00.500Z') });
	});

	it('rejects attach tickets for sessions expired while detached', async () => {
		expect.assertions(3);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			detachedIdleTtlMs: 1_000
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const { session } = await service.createOrReuse('user-1', { hostId: host.id });
		await service.markDetached('user-1', session.id, new Date('2026-05-13T12:00:00.000Z'));

		await expect(
			service.createAttachTicket('user-1', session.id, new Date('2026-05-13T12:00:01.000Z'))
		).rejects.toMatchObject({ issues: ['SSH live session expired while detached'] });
		await expect(repository.getSshLiveSession('user-1', session.id)).resolves.toMatchObject({
			status: 'ended',
			endedAt: new Date('2026-05-13T12:00:01.000Z')
		});

		const reused = await service.createOrReuse('user-1', {
			hostId: host.id,
			now: new Date('2026-05-13T12:00:02.000Z')
		});
		expect(reused.reused).toBe(false);
	});

	it('marks existing live metadata stale on startup and expires detached sessions', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			detachedIdleTtlMs: 1_000
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const first = await service.createOrReuse('user-1', { hostId: host.id });

		await expect(service.markStaleOnStartup(new Date('2026-05-13T12:00:00.000Z'))).resolves.toBe(1);
		await expect(repository.getSshLiveSession('user-1', first.session.id)).resolves.toMatchObject({
			status: 'stale',
			endedAt: new Date('2026-05-13T12:00:00.000Z')
		});

		const second = await service.createOrReuse('user-1', { hostId: host.id });
		await service.markDetached('user-1', second.session.id, new Date('2026-05-13T12:00:10.000Z'));
		const expired = await service.expireIdleDetachedSessions(new Date('2026-05-13T12:00:11.000Z'));

		expect(expired).toHaveLength(1);
		expect(expired[0]).toMatchObject({
			id: second.session.id,
			status: 'ended',
			endedAt: new Date('2026-05-13T12:00:11.000Z')
		});
		await expect(repository.countOpenSshLiveSessions('user-1')).resolves.toBe(0);
	});
});
