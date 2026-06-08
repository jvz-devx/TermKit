import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listHostGroupsForUser, setHostGroupIdsForHost } from '../host-groups';

const db = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db }));

describe('host group services', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists user host groups with membership counts and serialized dates', async () => {
		const createdAt = new Date('2026-05-20T12:00:00.000Z');
		const updatedAt = new Date('2026-05-21T12:00:00.000Z');
		queueSelectWhere([
			hostGroupRecord({ id: 'group-z', name: 'Zulu', createdAt, updatedAt }),
			hostGroupRecord({ id: 'group-a', name: 'Alpha', createdAt, updatedAt })
		]);
		queueJoinedSelectWhere([
			{ groupId: 'group-z' },
			{ groupId: 'group-a' },
			{ groupId: 'group-z' }
		]);

		await expect(listHostGroupsForUser('user-1')).resolves.toEqual([
			{
				id: 'group-a',
				name: 'Alpha',
				hostCount: 1,
				createdAt: createdAt.toISOString(),
				updatedAt: updatedAt.toISOString()
			},
			{
				id: 'group-z',
				name: 'Zulu',
				hostCount: 2,
				createdAt: createdAt.toISOString(),
				updatedAt: updatedAt.toISOString()
			}
		]);
		expect(db.select).toHaveBeenCalledTimes(2);
	});

	it('allows workspace owners to assign their groups to accessible workspace hosts', async () => {
		queueSelectLimit([
			{
				id: 'host-1',
				userId: 'host-creator',
				workspaceId: 'workspace-1'
			}
		]);
		queueSelectLimit([{ id: 'membership-1' }]);
		queueSelectWhere([hostGroupRecord({ id: 'group-1', name: 'Production' })]);
		const deleteWhere = vi.fn().mockResolvedValue(undefined);
		db.delete.mockReturnValueOnce({ where: deleteWhere });
		const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
		const values = vi.fn(() => ({ onConflictDoNothing }));
		db.insert.mockReturnValueOnce({ values });

		await expect(setHostGroupIdsForHost('user-1', 'host-1', ['group-1'])).resolves.toBeUndefined();

		expect(db.select).toHaveBeenCalledTimes(3);
		expect(deleteWhere).toHaveBeenCalledOnce();
		expect(values).toHaveBeenCalledWith([{ hostGroupId: 'group-1', hostId: 'host-1' }]);
		expect(onConflictDoNothing).toHaveBeenCalledOnce();
	});
});

function queueSelectWhere(rows: unknown[]) {
	const where = vi.fn().mockResolvedValue(rows);
	const from = vi.fn(() => ({ where }));
	db.select.mockReturnValueOnce({ from });
	return { from, where };
}

function queueJoinedSelectWhere(rows: unknown[]) {
	const where = vi.fn().mockResolvedValue(rows);
	const innerJoin = vi.fn(() => ({ where }));
	const from = vi.fn(() => ({ innerJoin }));
	db.select.mockReturnValueOnce({ from });
	return { from, innerJoin, where };
}

function queueSelectLimit(rows: unknown[]) {
	const limit = vi.fn().mockResolvedValue(rows);
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	db.select.mockReturnValueOnce({ from });
	return { from, where, limit };
}

function hostGroupRecord(overrides: {
	id: string;
	name: string;
	createdAt?: Date;
	updatedAt?: Date;
}) {
	const createdAt = overrides.createdAt ?? new Date('2026-05-20T12:00:00.000Z');
	const updatedAt = overrides.updatedAt ?? new Date('2026-05-21T12:00:00.000Z');
	return {
		id: overrides.id,
		userId: 'user-1',
		name: overrides.name,
		metadata: {},
		createdAt,
		updatedAt
	};
}
