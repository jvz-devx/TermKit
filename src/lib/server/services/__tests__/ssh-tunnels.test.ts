import { describe, expect, it } from 'vitest';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { InMemorySshTunnelRepository, publicSshTunnelPath, SshTunnelService } from '../ssh-tunnels';

describe('SshTunnelService', () => {
	it('saves host-bound profiles and starts browser-addressable sessions', async () => {
		expect.assertions(8);

		const services = new InMemoryTermixServicesRepository();
		const tunnels = new InMemorySshTunnelRepository();
		const hosts = new HostService(services);
		const service = new SshTunnelService(tunnels, hosts, services);
		const host = await hosts.create('user-1', {
			name: 'Jump host',
			protocol: 'ssh',
			hostname: 'jump.example.test',
			port: 22,
			username: 'ops'
		});

		const profile = await service.saveProfile('user-1', {
			hostId: host.id,
			name: 'Internal dashboard',
			targetHost: '127.0.0.1',
			targetPort: 8080
		});
		const session = await service.startSession('user-1', { profileId: profile.id });

		expect(profile).toMatchObject({
			userId: 'user-1',
			hostId: host.id,
			name: 'Internal dashboard',
			targetHost: '127.0.0.1',
			targetPort: 8080
		});
		expect(session).toMatchObject({
			userId: 'user-1',
			profileId: profile.id,
			hostId: host.id,
			targetHost: '127.0.0.1',
			targetPort: 8080,
			status: 'active',
			failureCode: null
		});
		expect(publicSshTunnelPath(session.id)).toBe(`/api/tunnels/${session.id}/proxy/`);
		await expect(service.listProfiles('user-1')).resolves.toHaveLength(1);
		await expect(service.listSessions('user-1')).resolves.toHaveLength(1);
		await expect(service.listProfiles('user-2')).resolves.toHaveLength(0);
		await expect(service.inspectSession('user-2', session.id)).rejects.toMatchObject({
			status: 404
		});
		await expect(
			service.startSession('user-1', { profileId: 'missing-profile' })
		).rejects.toMatchObject({ status: 404 });
	});

	it('validates SSH host access, target address, credentials, and usernames', async () => {
		expect.assertions(5);

		const services = new InMemoryTermixServicesRepository();
		const tunnels = new InMemorySshTunnelRepository();
		const hosts = new HostService(services);
		const service = new SshTunnelService(tunnels, hosts, services);
		const rdpHost = await hosts.create('user-1', {
			name: 'Windows',
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389,
			username: 'admin'
		});
		const sshHostWithoutUsername = await hosts.create('user-1', {
			name: 'No user',
			protocol: 'ssh',
			hostname: 'jump.example.test',
			port: 22
		});
		const sshHostWithMissingCredential = await services.createHost({
			id: 'host-with-missing-credential',
			userId: 'user-1',
			workspaceId: null,
			name: 'Broken jump',
			protocol: 'ssh',
			hostname: 'jump.example.test',
			port: 22,
			username: 'ops',
			credentialId: 'missing-credential',
			folder: null,
			tags: [],
			notes: null,
			metadata: {},
			createdAt: new Date(),
			updatedAt: new Date()
		});

		await expect(
			service.saveProfile('user-1', {
				hostId: rdpHost.id,
				name: 'Dashboard',
				targetHost: '127.0.0.1',
				targetPort: 8080
			})
		).rejects.toMatchObject({ issues: ['SSH tunnels require an SSH host'] });
		await expect(
			service.saveProfile('user-1', {
				hostId: sshHostWithoutUsername.id,
				name: 'Dashboard',
				targetHost: '127.0.0.1',
				targetPort: 8080
			})
		).rejects.toMatchObject({
			issues: ['host username or credential username is required']
		});
		await expect(
			service.saveProfile('user-1', {
				hostId: sshHostWithMissingCredential.id,
				name: 'Dashboard',
				targetHost: '127.0.0.1',
				targetPort: 8080
			})
		).rejects.toMatchObject({ issues: ['host credential is unavailable'] });
		await expect(
			service.startSession('user-1', {
				hostId: 'missing-host',
				name: 'Dashboard',
				targetHost: '127.0.0.1',
				targetPort: 8080
			})
		).rejects.toMatchObject({
			issues: ['hostId must reference an existing host accessible to the user']
		});
		await expect(
			service.startSession('user-1', {
				hostId: rdpHost.id,
				name: 'Dashboard',
				targetHost: 'http://127.0.0.1/admin',
				targetPort: 70000
			})
		).rejects.toMatchObject({
			issues: [
				'targetHost must be a hostname or IP address without a scheme or path',
				'targetPort must be an integer between 1 and 65535'
			]
		});
	});

	it('enforces per-user session limits and tracks idle, expired, ended, and failed states', async () => {
		expect.assertions(11);

		const services = new InMemoryTermixServicesRepository();
		const tunnels = new InMemorySshTunnelRepository();
		const hosts = new HostService(services);
		const service = new SshTunnelService(tunnels, hosts, services, {
			maxOpenSessionsPerUser: 1,
			idleAfterMs: 1_000
		});
		const host = await hosts.create('user-1', {
			name: 'Jump host',
			protocol: 'ssh',
			hostname: 'jump.example.test',
			port: 22,
			username: 'ops'
		});

		const first = await service.startSession('user-1', {
			hostId: host.id,
			name: 'Dashboard',
			targetHost: '127.0.0.1',
			targetPort: 8080
		});

		await expect(
			service.startSession('user-1', {
				hostId: host.id,
				name: 'Metrics',
				targetHost: '127.0.0.1',
				targetPort: 9090
			})
		).rejects.toMatchObject({ issues: ['SSH tunnel session limit reached (1)'] });

		const idle = await service.inspectSession(
			'user-1',
			first.id,
			new Date(first.startedAt.getTime() + 1_000)
		);
		expect(idle.status).toBe('idle');

		const touched = await service.touchSessionForProxy(
			'user-1',
			first.id,
			new Date(first.startedAt.getTime() + 1_500)
		);
		expect(touched.status).toBe('active');
		expect(touched.lastUsedAt).toEqual(new Date(first.startedAt.getTime() + 1_500));

		const idleAgain = await service.inspectSession(
			'user-1',
			first.id,
			new Date(first.startedAt.getTime() + 2_500)
		);
		expect(idleAgain.status).toBe('idle');
		const expired = await service.inspectSession(
			'user-1',
			first.id,
			new Date(first.startedAt.getTime() + 3_500)
		);
		expect(expired.status).toBe('ended');

		const second = await service.startSession('user-1', {
			hostId: host.id,
			name: 'Metrics',
			targetHost: '127.0.0.1',
			targetPort: 9090
		});
		expect(second.status).toBe('active');

		const failed = await service.failSession('user-1', second.id, 'target_unreachable');
		expect(failed.status).toBe('failed');
		expect(failed.failureCode).toBe('target_unreachable');

		await expect(service.touchSessionForProxy('user-1', second.id)).rejects.toMatchObject({
			issues: ['SSH tunnel session failed: target_unreachable']
		});

		const ended = await service.terminateSession('user-1', second.id);
		expect(ended.status).toBe('ended');
	});
});
