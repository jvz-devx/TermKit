import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import {
	hostGroupsByHostId,
	listHostGroupsForUser,
	setHostGroupIdsForHost,
	toHostGroupSummary
} from '$lib/server/services/host-groups';
import {
	createHostGroup,
	deleteHostGroup,
	listHostGroups,
	renameHostGroup,
	setHostGroupMembership,
	setHostGroupsForHost
} from './host-groups.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: { user: { id: 'user-1', username: 'ada' } } as {
			user?: { id: string; username: string };
		},
		url: new URL('https://termix.test/hosts')
	},
	refresh: vi.fn()
}));

const db = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}));

vi.mock('$app/server', () => {
	function remoteCallable(type: 'command' | 'query', fn: (input?: unknown) => unknown) {
		const wrapper = vi.fn((input?: unknown) => {
			const promise = Promise.resolve(fn(input)) as Promise<unknown> & { refresh: () => void };
			promise.refresh = appServer.refresh;
			return promise;
		});
		Object.defineProperty(wrapper, '__', { value: { type } });
		return wrapper;
	}

	return {
		getRequestEvent: () => appServer.event,
		query: (fn: () => unknown) => remoteCallable('query', fn),
		command: (_validation: unknown, fn: (input?: unknown) => unknown) =>
			remoteCallable('command', fn)
	};
});

vi.mock('$lib/server/db', () => ({ db }));

vi.mock('$lib/server/services/host-groups', () => ({
	hostGroupsByHostId: vi.fn(),
	listHostGroupsForUser: vi.fn(),
	setHostGroupIdsForHost: vi.fn(),
	toHostGroupSummary: vi.fn((group: HostGroupRow) => ({
		id: group.id,
		name: group.name,
		hostCount: 0,
		createdAt: group.createdAt.toISOString(),
		updatedAt: group.updatedAt.toISOString()
	}))
}));

describe('host group remote functions', () => {
	const now = new Date('2026-05-22T10:00:00.000Z');

	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: { user: { id: 'user-1', username: 'ada' } },
			url: new URL('https://termix.test/hosts')
		};
		db.insert.mockReturnValue({ values: vi.fn() });
		vi.mocked(listHostGroupsForUser).mockResolvedValue([]);
		vi.mocked(hostGroupsByHostId).mockResolvedValue(new Map());
	});

	it('rejects host group reads without invoking services when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/hosts')
		};

		await expect(listHostGroups()).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(listHostGroupsForUser).not.toHaveBeenCalled();
	});

	it('lists host groups through the service with stable summary serialization', async () => {
		const summary = {
			id: 'group-1',
			name: 'Production',
			hostCount: 2,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString()
		};
		vi.mocked(listHostGroupsForUser).mockResolvedValueOnce([summary]);

		await expect(listHostGroups()).resolves.toEqual([summary]);
		expect(listHostGroupsForUser).toHaveBeenCalledWith('user-1');
	});

	it('validates create input before inserting and refreshes after successful creation', async () => {
		const invalidInsert = { values: vi.fn() };
		db.insert.mockReturnValueOnce(invalidInsert);

		await expect(createHostGroup({ name: '  ' })).rejects.toMatchObject({
			issues: ['name is required']
		});
		expect(invalidInsert.values).not.toHaveBeenCalled();
		expect(appServer.refresh).not.toHaveBeenCalled();

		const group = hostGroupRow({
			id: 'group-1',
			name: 'Production',
			createdAt: now,
			updatedAt: now
		});
		const insert = queueInsertReturning([group]);

		await expect(createHostGroup({ name: ' Production ' })).resolves.toEqual({
			id: 'group-1',
			name: 'Production',
			hostCount: 0,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString()
		});
		expect(insert.values).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'user-1', name: 'Production', metadata: {} })
		);
		expect(toHostGroupSummary).toHaveBeenCalledWith(group);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('validates rename input before updating and refreshes after a matched owner update', async () => {
		await expect(renameHostGroup({ id: '', name: 'Production' })).rejects.toMatchObject({
			issues: ['id is required']
		});
		expect(db.update).not.toHaveBeenCalled();

		const update = queueUpdateReturning([{ id: 'group-1' }]);

		await expect(renameHostGroup({ id: 'group-1', name: ' Production ' })).resolves.toBeUndefined();
		expect(update.set).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Production', updatedAt: expect.any(Date) })
		);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('rejects rename misses without refreshing', async () => {
		queueUpdateReturning([]);

		await expect(
			renameHostGroup({ id: 'group-missing', name: 'Production' })
		).rejects.toMatchObject({
			issues: ['group not found']
		});
		expect(appServer.refresh).not.toHaveBeenCalled();
	});

	it('validates delete input before deleting and refreshes after owner-scoped deletion', async () => {
		await expect(deleteHostGroup('')).rejects.toMatchObject({
			issues: ['id is required']
		});
		expect(db.delete).not.toHaveBeenCalled();

		queueDelete();

		await expect(deleteHostGroup('group-1')).resolves.toBeUndefined();
		expect(db.delete).toHaveBeenCalledOnce();
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('rejects membership changes for groups outside the user ownership scope', async () => {
		queueSelectLimit([]);

		await expect(
			setHostGroupMembership({ hostId: 'host-1', groupId: 'group-1', assigned: true })
		).rejects.toMatchObject({
			issues: ['groupId must reference an owned group']
		});
		expect(setHostGroupIdsForHost).not.toHaveBeenCalled();
		expect(appServer.refresh).not.toHaveBeenCalled();
	});

	it('delegates single membership assignment through the host group service', async () => {
		queueSelectLimit([{ id: 'group-2' }]);
		vi.mocked(hostGroupsByHostId).mockResolvedValueOnce(
			new Map([
				[
					'host-1',
					[
						{
							id: 'group-1',
							name: 'Existing',
							hostCount: 0,
							createdAt: now.toISOString(),
							updatedAt: now.toISOString()
						}
					]
				]
			])
		);

		await expect(
			setHostGroupMembership({ hostId: 'host-1', groupId: 'group-2', assigned: true })
		).resolves.toBeUndefined();

		expect(setHostGroupIdsForHost).toHaveBeenCalledWith('user-1', 'host-1', ['group-1', 'group-2']);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('delegates single membership removal through the host group service', async () => {
		queueSelectLimit([{ id: 'group-2' }]);
		vi.mocked(hostGroupsByHostId).mockResolvedValueOnce(
			new Map([
				[
					'host-1',
					[
						{
							id: 'group-1',
							name: 'Existing',
							hostCount: 0,
							createdAt: now.toISOString(),
							updatedAt: now.toISOString()
						},
						{
							id: 'group-2',
							name: 'Remove me',
							hostCount: 0,
							createdAt: now.toISOString(),
							updatedAt: now.toISOString()
						}
					]
				]
			])
		);

		await expect(
			setHostGroupMembership({ hostId: 'host-1', groupId: 'group-2', assigned: false })
		).resolves.toBeUndefined();

		expect(setHostGroupIdsForHost).toHaveBeenCalledWith('user-1', 'host-1', ['group-1']);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('requires an explicit boolean for membership changes before ownership checks', async () => {
		await expect(
			setHostGroupMembership({ hostId: 'host-1', groupId: 'group-1', assigned: 'yes' })
		).rejects.toMatchObject({
			issues: ['assigned must be a boolean']
		});
		expect(db.select).not.toHaveBeenCalled();
	});

	it('filters bulk host group membership input and refreshes after service assignment', async () => {
		vi.mocked(setHostGroupIdsForHost).mockResolvedValueOnce(undefined);

		await expect(
			setHostGroupsForHost({
				hostId: 'host-1',
				groupIds: ['group-1', '', 'group-2', 'group-1', 42]
			})
		).resolves.toBeUndefined();

		expect(setHostGroupIdsForHost).toHaveBeenCalledWith('user-1', 'host-1', ['group-1', 'group-2']);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('rejects invalid bulk host group input before invoking the service', async () => {
		await expect(
			setHostGroupsForHost({ hostId: 'host-1', groupIds: 'group-1' })
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(setHostGroupIdsForHost).not.toHaveBeenCalled();
		expect(appServer.refresh).not.toHaveBeenCalled();
	});
});

type HostGroupRow = {
	id: string;
	userId: string;
	name: string;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
};

function queueInsertReturning(rows: unknown[]) {
	const returning = vi.fn().mockResolvedValue(rows);
	const onConflictDoUpdate = vi.fn(() => ({ returning }));
	const values = vi.fn(() => ({ onConflictDoUpdate }));
	db.insert.mockReturnValueOnce({ values });
	return { values, onConflictDoUpdate, returning };
}

function queueUpdateReturning(rows: unknown[]) {
	const returning = vi.fn().mockResolvedValue(rows);
	const where = vi.fn(() => ({ returning }));
	const set = vi.fn(() => ({ where }));
	db.update.mockReturnValueOnce({ set });
	return { set, where, returning };
}

function queueDelete() {
	const where = vi.fn().mockResolvedValue(undefined);
	db.delete.mockReturnValueOnce({ where });
	return { where };
}

function queueSelectLimit(rows: unknown[]) {
	const limit = vi.fn().mockResolvedValue(rows);
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	db.select.mockReturnValueOnce({ from });
	return { from, where, limit };
}

function hostGroupRow(overrides: { id: string; name: string; createdAt: Date; updatedAt: Date }) {
	return {
		id: overrides.id,
		userId: 'user-1',
		name: overrides.name,
		metadata: {},
		createdAt: overrides.createdAt,
		updatedAt: overrides.updatedAt
	};
}
