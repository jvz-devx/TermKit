import { describe, expect, it } from 'vitest';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { RdpLiveSessionService } from '../rdp-live-sessions';

describe('RdpLiveSessionService', () => {
	it('creates a persistent RDP session and marks it active on attach', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new RdpLiveSessionService(repository, hosts);
		const host = await hosts.create('user-1', {
			name: 'Windows desktop',
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389
		});

		const session = await service.create('user-1', {
			hostId: host.id,
			now: new Date('2026-07-06T10:00:00.000Z')
		});
		const attached = await service.prepareAttach(
			'user-1',
			session.id,
			new Date('2026-07-06T10:01:00.000Z')
		);

		expect(session).toMatchObject({
			userId: 'user-1',
			hostId: host.id,
			title: 'Windows desktop',
			status: 'detached',
			lastAttachedAt: null
		});
		expect(attached).toMatchObject({
			id: session.id,
			status: 'active',
			lastAttachedAt: new Date('2026-07-06T10:01:00.000Z')
		});
	});

	it('rejects non-RDP hosts and enforces per-user open session limits', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new RdpLiveSessionService(repository, hosts, { maxLiveSessionsPerUser: 1 });
		const rdpHost = await hosts.create('user-1', {
			name: 'Windows 1',
			protocol: 'rdp',
			hostname: 'windows-1.example.test',
			port: 3389
		});
		const secondRdpHost = await hosts.create('user-1', {
			name: 'Windows 2',
			protocol: 'rdp',
			hostname: 'windows-2.example.test',
			port: 3389
		});
		const sshHost = await hosts.create('user-1', {
			name: 'Shell',
			protocol: 'ssh',
			hostname: 'shell.example.test',
			port: 22
		});

		await service.create('user-1', { hostId: rdpHost.id });

		await expect(service.create('user-1', { hostId: sshHost.id })).rejects.toMatchObject({
			issues: ['RDP sessions require an RDP host']
		});
		await expect(service.create('user-1', { hostId: secondRdpHost.id })).rejects.toMatchObject({
			issues: ['live RDP session limit reached (1)']
		});
	});

	it('keeps ended sessions visible briefly and then hides them', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const hosts = new HostService(repository);
		const service = new RdpLiveSessionService(repository, hosts, { statusVisibleMs: 1_000 });
		const host = await hosts.create('user-1', {
			name: 'Windows desktop',
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389
		});
		const session = await service.create('user-1', {
			hostId: host.id,
			now: new Date('2026-07-06T10:00:00.000Z')
		});
		await service.close('user-1', session.id, new Date('2026-07-06T10:00:01.000Z'));

		await expect(
			service.listVisible('user-1', new Date('2026-07-06T10:00:01.500Z'))
		).resolves.toHaveLength(1);
		await expect(
			service.listVisible('user-1', new Date('2026-07-06T10:00:03.000Z'))
		).resolves.toHaveLength(0);
	});
});
