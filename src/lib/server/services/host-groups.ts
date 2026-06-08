import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { hostGroupMembers, hostGroups, hosts, workspaceMemberships } from '$lib/server/db/schema';
import { ServiceValidationError } from './errors';
import type { HostGroupSummary } from '$lib/remotes/termix-core.shared';

export async function listHostGroupsForUser(userId: string): Promise<HostGroupSummary[]> {
	const [groupRows, memberRows] = await Promise.all([
		db.select().from(hostGroups).where(eq(hostGroups.userId, userId)),
		db
			.select({ groupId: hostGroupMembers.hostGroupId })
			.from(hostGroupMembers)
			.innerJoin(hostGroups, eq(hostGroups.id, hostGroupMembers.hostGroupId))
			.where(eq(hostGroups.userId, userId))
	]);
	const counts = new Map<string, number>();
	for (const member of memberRows)
		counts.set(member.groupId, (counts.get(member.groupId) ?? 0) + 1);
	return groupRows
		.map((group) => ({ ...toHostGroupSummary(group), hostCount: counts.get(group.id) ?? 0 }))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export async function hostGroupsByHostId(userId: string): Promise<Map<string, HostGroupSummary[]>> {
	const groups = await listHostGroupsForUser(userId);
	const groupById = new Map(groups.map((group) => [group.id, group]));
	const memberships = await db
		.select({ hostId: hostGroupMembers.hostId, groupId: hostGroupMembers.hostGroupId })
		.from(hostGroupMembers)
		.innerJoin(hostGroups, eq(hostGroups.id, hostGroupMembers.hostGroupId))
		.where(eq(hostGroups.userId, userId));
	const result = new Map<string, HostGroupSummary[]>();
	for (const membership of memberships) {
		const group = groupById.get(membership.groupId);
		if (!group) continue;
		const hostGroups = result.get(membership.hostId) ?? [];
		hostGroups.push(group);
		result.set(membership.hostId, hostGroups);
	}
	for (const value of result.values())
		value.sort((left, right) => left.name.localeCompare(right.name));
	return result;
}

export async function setHostGroupIdsForHost(
	userId: string,
	hostId: string,
	groupIds: string[]
): Promise<void> {
	await assertHostGroupAssignableByUser(userId, hostId);
	const ownedGroups = await db
		.select({ id: hostGroups.id })
		.from(hostGroups)
		.where(eq(hostGroups.userId, userId));
	const ownedGroupIds = ownedGroups.map((group) => group.id);
	const ownedGroupIdSet = new Set(ownedGroupIds);
	if (groupIds.some((groupId) => !ownedGroupIdSet.has(groupId))) {
		throw new ServiceValidationError(['groupIds must reference existing groups']);
	}
	if (ownedGroupIds.length > 0) {
		await db
			.delete(hostGroupMembers)
			.where(
				and(
					eq(hostGroupMembers.hostId, hostId),
					inArray(hostGroupMembers.hostGroupId, ownedGroupIds)
				)
			);
	}
	if (groupIds.length > 0) {
		await db
			.insert(hostGroupMembers)
			.values(groupIds.map((groupId) => ({ hostGroupId: groupId, hostId })))
			.onConflictDoNothing({
				target: [hostGroupMembers.hostGroupId, hostGroupMembers.hostId]
			});
	}
}

export function toHostGroupSummary(group: typeof hostGroups.$inferSelect): HostGroupSummary {
	return {
		id: group.id,
		name: group.name,
		hostCount: 0,
		createdAt: group.createdAt.toISOString(),
		updatedAt: group.updatedAt.toISOString()
	};
}

async function assertHostGroupAssignableByUser(userId: string, hostId: string): Promise<void> {
	const [host] = await db
		.select({ id: hosts.id, userId: hosts.userId, workspaceId: hosts.workspaceId })
		.from(hosts)
		.where(eq(hosts.id, hostId))
		.limit(1);
	if (!host) throw new ServiceValidationError(['hostId must reference an accessible host']);
	if (host.userId === userId) return;
	if (!host.workspaceId)
		throw new ServiceValidationError(['hostId must reference an accessible host']);

	const [membership] = await db
		.select({ id: workspaceMemberships.id })
		.from(workspaceMemberships)
		.where(
			and(
				eq(workspaceMemberships.workspaceId, host.workspaceId),
				eq(workspaceMemberships.userId, userId),
				eq(workspaceMemberships.role, 'owner')
			)
		)
		.limit(1);
	if (!membership) throw new ServiceValidationError(['hostId must reference an accessible host']);
}
