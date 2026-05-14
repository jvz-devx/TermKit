import { describe, expect, it } from 'vitest';
import { ConnectionSessionService } from '../connection-sessions';
import { InMemoryTermixServicesRepository } from '../repository';

describe('ConnectionSessionService', () => {
	it('records start, active, ended, and failed lifecycle states', async () => {
		expect.assertions(7);

		const repository = new InMemoryTermixServicesRepository();
		const service = new ConnectionSessionService(repository);
		const startedAt = new Date('2026-05-13T12:00:00.000Z');
		const activeAt = new Date('2026-05-13T12:00:01.000Z');
		const endedAt = new Date('2026-05-13T12:00:02.000Z');
		const failedAt = new Date('2026-05-13T12:00:03.000Z');

		const session = await service.start({
			id: 'connection-session-1',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			now: startedAt
		});
		expect(session).toMatchObject({
			id: 'connection-session-1',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			status: 'starting',
			startedAt,
			endedAt: null,
			errorCode: null
		});

		await expect(service.markActive(session.id, activeAt)).resolves.toMatchObject({
			status: 'active',
			errorCode: null,
			updatedAt: activeAt
		});
		await expect(service.end(session.id, endedAt)).resolves.toMatchObject({
			status: 'ended',
			endedAt,
			errorCode: null,
			updatedAt: endedAt
		});

		const failed = await service.start({
			userId: 'user-1',
			hostId: 'host-2',
			protocol: 'telnet',
			now: startedAt
		});
		await expect(service.fail(failed.id, 'websocket_close_1011', failedAt)).resolves.toMatchObject({
			status: 'failed',
			endedAt: failedAt,
			errorCode: 'websocket_close_1011',
			updatedAt: failedAt
		});

		await expect(repository.getConnectionSession(session.id)).resolves.toMatchObject({
			status: 'ended'
		});
		await expect(repository.getConnectionSession(failed.id)).resolves.toMatchObject({
			status: 'failed'
		});
		await expect(service.end('missing-session')).resolves.toBeNull();
	});

	it('only updates browser-reported lifecycle events for the owning user', async () => {
		const repository = new InMemoryTermixServicesRepository();
		const service = new ConnectionSessionService(repository);
		const session = await service.start({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'rdp'
		});

		await expect(service.markActiveForUser('user-2', session.id)).resolves.toBeNull();
		await expect(repository.getConnectionSession(session.id)).resolves.toMatchObject({
			status: 'starting'
		});
		await expect(service.markActiveForUser('user-1', session.id)).resolves.toMatchObject({
			status: 'active'
		});
		await expect(service.endForUser('user-1', session.id)).resolves.toMatchObject({
			status: 'ended'
		});
	});
});
