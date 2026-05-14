import { describe, expect, it } from 'vitest';
import { ConnectionSessionService } from '../connection-sessions';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';
import { WorkspaceService } from '../workspaces';

describe('ConnectionSessionService history', () => {
	it('lists workspace history with host, user, workspace, duration, status, and error reason', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const workspaces = new WorkspaceService(repository);
		const hosts = new HostService(repository);
		const sessions = new ConnectionSessionService(repository);
		const startedAt = new Date('2026-05-13T12:00:00.000Z');
		const endedAt = new Date('2026-05-13T12:00:05.500Z');
		const failedAt = new Date('2026-05-13T12:00:09.000Z');

		const workspace = await workspaces.create('owner-1', { name: 'Ops' });
		await workspaces.addMember('owner-1', workspace.id, { userId: 'member-1' });
		const host = await hosts.create('owner-1', {
			workspaceId: workspace.id,
			name: 'Shared SSH',
			protocol: 'ssh',
			hostname: 'shared.example.test',
			port: 22,
			username: 'deploy'
		});
		const successful = await sessions.start({
			userId: 'owner-1',
			hostId: host.id,
			protocol: 'ssh',
			now: startedAt
		});
		await sessions.end(successful.id, endedAt);
		const failed = await sessions.start({
			userId: 'member-1',
			hostId: host.id,
			protocol: 'ssh',
			now: new Date('2026-05-13T12:00:08.000Z')
		});
		await sessions.fail(failed.id, 'connection refused', failedAt);
		await sessions.start({
			userId: 'member-1',
			hostId: null,
			protocol: 'telnet',
			now: new Date('2026-05-13T12:00:10.000Z')
		});

		await expect(sessions.listHistory('member-1', { workspaceId: workspace.id })).resolves.toEqual([
			expect.objectContaining({
				id: failed.id,
				userId: 'member-1',
				workspaceId: workspace.id,
				workspaceName: 'Ops',
				hostId: host.id,
				hostName: 'Shared SSH',
				hostname: 'shared.example.test',
				hostUsername: 'deploy',
				protocol: 'ssh',
				startedAt: new Date('2026-05-13T12:00:08.000Z'),
				endedAt: failedAt,
				durationMs: 1000,
				status: 'failed',
				errorReason: 'connection refused'
			}),
			expect.objectContaining({
				id: successful.id,
				userId: 'owner-1',
				workspaceId: workspace.id,
				durationMs: 5500,
				status: 'ended',
				errorReason: null
			})
		]);
		await expect(sessions.listHistory('owner-1', { status: 'failed' })).resolves.toEqual([
			expect.objectContaining({ id: failed.id })
		]);
	});
});
