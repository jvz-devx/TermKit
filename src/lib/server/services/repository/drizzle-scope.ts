import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

type WorkspaceScopedTable = {
	userId: AnyPgColumn<{ data: string }>;
	workspaceId: AnyPgColumn<{ data: string | null }>;
};

export function workspaceScopedUserFilter(
	table: WorkspaceScopedTable,
	userId: string,
	workspaceIds: string[]
) {
	return workspaceIds.length > 0
		? or(
				and(eq(table.userId, userId), isNull(table.workspaceId)),
				inArray(table.workspaceId, workspaceIds)
			)
		: and(eq(table.userId, userId), isNull(table.workspaceId));
}
