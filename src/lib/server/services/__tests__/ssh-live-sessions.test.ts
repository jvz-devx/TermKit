import { describe, expect, it } from 'vitest';
import { TicketConsumedError, TicketExpiredError, TicketInvalidError } from '../errors';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { SshLiveSessionService } from '../ssh-live-sessions';

describe('SshLiveSessionService', () => {
	it('creates separate same-host sessions unless reuse is requested', async () => {
		expect.assertions(9);

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
		const second = await service.createOrReuse('user-1', {
			hostId: host.id,
			now: new Date('2026-05-13T12:00:01.000Z')
		});
		const reused = await service.createOrReuse('user-1', {
			hostId: host.id,
			title: 'Renamed tab',
			reuseExisting: true,
			now: new Date('2026-05-13T12:00:02.000Z')
		});

		expect(created.reused).toBe(false);
		expect(created.session).toMatchObject({
			userId: 'user-1',
			hostId: host.id,
			title: 'Production shell',
			status: 'starting',
			expiresAt: new Date('2026-05-13T12:01:00.000Z'),
			terminalCols: 120,
			terminalRows: 32
		});
		expect(second.reused).toBe(false);
		expect(second.session.id).not.toBe(created.session.id);
		expect(second.session.title).toBe('Production shell 2');
		expect(reused.reused).toBe(true);
		expect(reused.session.id).toBe(created.session.id);
		expect(reused.session.title).toBe('Renamed tab');
		await expect(service.list('user-1')).resolves.toHaveLength(2);
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

	it('allows multiple live sessions per user up to the configured limit', async () => {
		expect.assertions(9);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			maxLiveSessionsPerUser: 2
		});
		const firstHost = await hosts.create('user-1', {
			name: 'Shell 1',
			protocol: 'ssh',
			hostname: 'shell-1.example.test',
			port: 22
		});
		const secondHost = await hosts.create('user-1', {
			name: 'Shell 2',
			protocol: 'ssh',
			hostname: 'shell-2.example.test',
			port: 22
		});
		const thirdHost = await hosts.create('user-1', {
			name: 'Shell 3',
			protocol: 'ssh',
			hostname: 'shell-3.example.test',
			port: 22
		});
		const otherUserHost = await hosts.create('user-2', {
			name: 'Other shell',
			protocol: 'ssh',
			hostname: 'other.example.test',
			port: 22
		});

		const first = await service.createOrReuse('user-1', { hostId: firstHost.id });
		const second = await service.createOrReuse('user-1', { hostId: firstHost.id });

		expect(first.reused).toBe(false);
		expect(second.reused).toBe(false);
		expect(second.session.id).not.toBe(first.session.id);
		expect(second.session.title).toBe('Shell 1 2');
		await expect(repository.countOpenSshLiveSessions('user-1')).resolves.toBe(2);
		await expect(service.createOrReuse('user-1', { hostId: secondHost.id })).rejects.toMatchObject({
			issues: ['live SSH session limit reached (2)']
		});

		const otherUser = await service.createOrReuse('user-2', { hostId: otherUserHost.id });
		expect(otherUser.reused).toBe(false);

		await service.end('user-1', first.session.id);
		const afterEnd = await service.createOrReuse('user-1', { hostId: thirdHost.id });

		expect(afterEnd.reused).toBe(false);
		await expect(repository.countOpenSshLiveSessions('user-1')).resolves.toBe(2);
	});

	it('expires abandoned starting sessions before enforcing user limits', async () => {
		expect.assertions(4);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			attachTicketTtlMs: 1_000,
			maxLiveSessionsPerUser: 1
		});
		const firstHost = await hosts.create('user-1', {
			name: 'Pending shell',
			protocol: 'ssh',
			hostname: 'pending.example.test',
			port: 22
		});
		const secondHost = await hosts.create('user-1', {
			name: 'Replacement shell',
			protocol: 'ssh',
			hostname: 'replacement.example.test',
			port: 22
		});

		const pending = await service.createOrReuse('user-1', {
			hostId: firstHost.id,
			now: new Date('2026-05-13T12:00:00.000Z')
		});
		const replacement = await service.createOrReuse('user-1', {
			hostId: secondHost.id,
			now: new Date('2026-05-13T12:00:01.000Z')
		});

		await expect(repository.getSshLiveSession('user-1', pending.session.id)).resolves.toMatchObject(
			{
				status: 'ended',
				endedAt: new Date('2026-05-13T12:00:01.000Z')
			}
		);
		expect(replacement.reused).toBe(false);
		expect(replacement.session.status).toBe('starting');
		await expect(repository.countOpenSshLiveSessions('user-1')).resolves.toBe(1);
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

	it('persists close, end, and fail terminal statuses', async () => {
		expect.assertions(9);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			detachedIdleTtlMs: 5_000
		});
		const closeHost = await hosts.create('user-1', {
			name: 'Close shell',
			protocol: 'ssh',
			hostname: 'close.example.test',
			port: 22
		});
		const endHost = await hosts.create('user-1', {
			name: 'End shell',
			protocol: 'ssh',
			hostname: 'end.example.test',
			port: 22
		});
		const failHost = await hosts.create('user-1', {
			name: 'Fail shell',
			protocol: 'ssh',
			hostname: 'fail.example.test',
			port: 22
		});
		const closeSession = await service.createOrReuse('user-1', { hostId: closeHost.id });
		const endSession = await service.createOrReuse('user-1', { hostId: endHost.id });
		const failSession = await service.createOrReuse('user-1', { hostId: failHost.id });

		await service.markDetached(
			'user-1',
			closeSession.session.id,
			new Date('2026-05-13T12:00:00.000Z')
		);

		await expect(
			service.close('user-1', closeSession.session.id, new Date('2026-05-13T12:00:01.000Z'))
		).resolves.toMatchObject({
			status: 'ended',
			endedAt: new Date('2026-05-13T12:00:01.000Z'),
			expiresAt: null
		});
		await expect(
			service.end('user-1', endSession.session.id, new Date('2026-05-13T12:00:02.000Z'))
		).resolves.toMatchObject({
			status: 'ended',
			endedAt: new Date('2026-05-13T12:00:02.000Z'),
			expiresAt: null
		});
		await expect(
			service.fail('user-1', failSession.session.id, new Date('2026-05-13T12:00:03.000Z'))
		).resolves.toMatchObject({
			status: 'failed',
			endedAt: new Date('2026-05-13T12:00:03.000Z'),
			expiresAt: null
		});
		await expect(
			service.createAttachTicket('user-1', closeSession.session.id)
		).rejects.toMatchObject({ issues: ['SSH live session is not attachable'] });
		await expect(service.createAttachTicket('user-1', endSession.session.id)).rejects.toMatchObject(
			{
				issues: ['SSH live session is not attachable']
			}
		);
		await expect(
			service.createAttachTicket('user-1', failSession.session.id)
		).rejects.toMatchObject({ issues: ['SSH live session is not attachable'] });
		await expect(repository.countOpenSshLiveSessions('user-1')).resolves.toBe(0);
		await expect(service.list('user-1')).resolves.toHaveLength(3);
		await expect(service.list('user-1')).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: closeSession.session.id, status: 'ended' }),
				expect.objectContaining({ id: endSession.session.id, status: 'ended' }),
				expect.objectContaining({ id: failSession.session.id, status: 'failed' })
			])
		);
	});

	it('lists live, stale, and recent terminal sessions for workspace visibility', async () => {
		expect.assertions(3);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			terminalStatusVisibleMs: 5_000
		});
		const liveHost = await hosts.create('user-1', {
			name: 'Live shell',
			protocol: 'ssh',
			hostname: 'live.example.test',
			port: 22
		});
		const recentHost = await hosts.create('user-1', {
			name: 'Recent shell',
			protocol: 'ssh',
			hostname: 'recent.example.test',
			port: 22
		});
		const oldHost = await hosts.create('user-1', {
			name: 'Old shell',
			protocol: 'ssh',
			hostname: 'old.example.test',
			port: 22
		});
		const staleHost = await hosts.create('user-1', {
			name: 'Stale shell',
			protocol: 'ssh',
			hostname: 'stale.example.test',
			port: 22
		});
		const live = await service.createOrReuse('user-1', {
			hostId: liveHost.id,
			now: new Date('2026-05-13T12:00:00.000Z')
		});
		const recent = await service.createOrReuse('user-1', {
			hostId: recentHost.id,
			now: new Date('2026-05-13T12:00:00.000Z')
		});
		const old = await service.createOrReuse('user-1', {
			hostId: oldHost.id,
			now: new Date('2026-05-13T12:00:00.000Z')
		});
		const stale = await service.createOrReuse('user-1', {
			hostId: staleHost.id,
			now: new Date('2026-05-13T12:00:00.000Z')
		});

		await service.end('user-1', recent.session.id, new Date('2026-05-13T12:00:08.000Z'));
		await service.fail('user-1', old.session.id, new Date('2026-05-13T12:00:00.000Z'));
		await service.end('user-1', live.session.id, new Date('2026-05-13T12:00:01.000Z'));
		await service.createOrReuse('user-1', {
			hostId: liveHost.id,
			now: new Date('2026-05-13T12:00:02.000Z')
		});
		await service.markStaleOnStartup(new Date('2026-05-13T12:00:03.000Z'));

		const visible = await service.listVisible('user-1', new Date('2026-05-13T12:00:10.000Z'));
		const visibleIds = visible.map((session) => session.id);

		expect(visibleIds).toContain(recent.session.id);
		expect(visibleIds).toContain(stale.session.id);
		expect(visibleIds).not.toContain(old.session.id);
	});

	it('rejects expired attach tickets, leaves the ticket unused, and ends pending sessions', async () => {
		expect.assertions(3);

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
			repository.getSshAttachTicketByHash(created.record.ticketHash)
		).resolves.toMatchObject({ consumedAt: null });
		await expect(repository.getSshLiveSession('user-1', session.id)).resolves.toMatchObject({
			status: 'ended',
			endedAt: new Date('2026-05-13T12:00:01.000Z')
		});
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

	it('rejects attach tickets for sessions expired before attachment', async () => {
		expect.assertions(2);

		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new SshLiveSessionService(repository, hosts, repository, {
			attachTicketTtlMs: 1_000
		});
		const host = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});
		const { session } = await service.createOrReuse('user-1', {
			hostId: host.id,
			now: new Date('2026-05-13T12:00:00.000Z')
		});

		await expect(
			service.createAttachTicket('user-1', session.id, new Date('2026-05-13T12:00:01.000Z'))
		).rejects.toMatchObject({ issues: ['SSH live session expired before attachment'] });
		await expect(repository.getSshLiveSession('user-1', session.id)).resolves.toMatchObject({
			status: 'ended',
			endedAt: new Date('2026-05-13T12:00:01.000Z')
		});
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
