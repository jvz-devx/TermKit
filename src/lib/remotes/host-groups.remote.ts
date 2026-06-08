import { command, getRequestEvent, query } from '$app/server';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { hostGroups } from '$lib/server/db/schema';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import {
	hostGroupsByHostId,
	listHostGroupsForUser,
	setHostGroupIdsForHost,
	toHostGroupSummary
} from '$lib/server/services/host-groups';
import type { HostGroupSummary } from './termix-core.shared';

export type HostGroupMutationInput = {
	id?: unknown;
	name?: unknown;
};

export type HostGroupMembershipInput = {
	hostId?: unknown;
	groupId?: unknown;
	assigned?: unknown;
	groupIds?: unknown;
};

export const listHostGroups = query(async (): Promise<HostGroupSummary[]> => {
	const userId = requireRemoteUser();
	return listHostGroupsForUser(userId);
});

export const createHostGroup = command<HostGroupMutationInput, HostGroupSummary>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const now = new Date();
		const [group] = await db
			.insert(hostGroups)
			.values({
				userId,
				name: requireGroupName(input.name),
				metadata: {},
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: [hostGroups.userId, hostGroups.name],
				set: { updatedAt: now }
			})
			.returning();
		if (!group) throw new ServiceValidationError(['group could not be saved']);
		void listHostGroups().refresh();
		return { ...toHostGroupSummary(group), hostCount: 0 };
	}
);

export const renameHostGroup = command<HostGroupMutationInput, void>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const id = requireId(input.id, 'id');
	const [updated] = await db
		.update(hostGroups)
		.set({ name: requireGroupName(input.name), updatedAt: new Date() })
		.where(and(eq(hostGroups.id, id), eq(hostGroups.userId, userId)))
		.returning({ id: hostGroups.id });
	if (!updated) throw new ServiceValidationError(['group not found']);
	void listHostGroups().refresh();
});

export const deleteHostGroup = command<string, void>('unchecked', async (id) => {
	const userId = requireRemoteUser();
	const groupId = requireId(id, 'id');
	await db.delete(hostGroups).where(and(eq(hostGroups.id, groupId), eq(hostGroups.userId, userId)));
	void listHostGroups().refresh();
});

export const setHostGroupMembership = command<HostGroupMembershipInput, void>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const hostId = requireId(input.hostId, 'hostId');
		const groupId = requireId(input.groupId, 'groupId');
		if (typeof input.assigned !== 'boolean') {
			throw new ServiceValidationError(['assigned must be a boolean']);
		}
		await assertGroupOwnedByUser(userId, groupId);
		if (input.assigned) {
			const currentGroups = (await hostGroupsByHostId(userId)).get(hostId) ?? [];
			await setHostGroupIdsForHost(userId, hostId, [
				...new Set([...currentGroups.map((group) => group.id), groupId])
			]);
		} else {
			const currentGroups = (await hostGroupsByHostId(userId)).get(hostId) ?? [];
			await setHostGroupIdsForHost(
				userId,
				hostId,
				currentGroups.map((group) => group.id).filter((id) => id !== groupId)
			);
		}
		void listHostGroups().refresh();
	}
);

export const setHostGroupsForHost = command<HostGroupMembershipInput, void>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const hostId = requireId(input.hostId, 'hostId');
		const groupIds = requireGroupIds(input.groupIds);
		await setHostGroupIdsForHost(userId, hostId, groupIds);
		void listHostGroups().refresh();
	}
);

function requireRemoteUser(): string {
	const user = getRequestEvent().locals.user;
	if (!user) throw new ServiceUnauthorizedError();
	return user.id;
}

function requireGroupName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new ServiceValidationError(['name is required']);
	}
	return value.trim();
}

function requireId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value)
		throw new ServiceValidationError([`${name} is required`]);
	return value;
}

function requireGroupIds(value: unknown): string[] {
	if (!Array.isArray(value)) throw new ServiceValidationError(['groupIds must be an array']);
	return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))];
}

async function assertGroupOwnedByUser(userId: string, groupId: string): Promise<void> {
	const [group] = await db
		.select({ id: hostGroups.id })
		.from(hostGroups)
		.where(and(eq(hostGroups.id, groupId), eq(hostGroups.userId, userId)))
		.limit(1);
	if (!group) throw new ServiceValidationError(['groupId must reference an owned group']);
}
