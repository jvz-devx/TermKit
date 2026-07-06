import { randomUUID } from 'node:crypto';
import { command, query } from '$app/server';
import { termixRepository } from '$lib/server/services/repository';
import { ServiceValidationError } from '$lib/server/services/errors';
import {
	requireRemoteUser,
	validateSessionWorkspaceLayoutMetadata,
	type SessionWorkspaceLayoutMetadata
} from './termix-core.shared';

export type { SessionWorkspaceLayoutMetadata } from './termix-core.shared';

export const getSessionWorkspaceLayout = query(
	async (): Promise<SessionWorkspaceLayoutMetadata | null> => {
		const userId = requireRemoteUser();
		const [layout] = await termixRepository.listWorkspaceLayouts(userId);
		if (!layout) return null;

		return {
			layout: layout.layoutKind,
			panes: layout.panes,
			tree: layout.tree ?? undefined,
			updatedAt: layout.updatedAt.toISOString()
		};
	}
);

export const saveSessionWorkspaceLayout = command<
	{ metadata?: unknown },
	SessionWorkspaceLayoutMetadata
>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const metadata = validateSessionWorkspaceLayoutMetadata(input.metadata);
	const [existing] = await termixRepository.listWorkspaceLayouts(userId);
	const now = new Date();
	const saved = existing
		? await termixRepository.updateWorkspaceLayout(userId, existing.id, {
				layoutKind: metadata.layout,
				panes: metadata.panes,
				tree: metadata.tree ?? null,
				updatedAt: now
			})
		: await termixRepository.createWorkspaceLayout({
				id: randomUUID(),
				userId,
				workspaceId: null,
				layoutKind: metadata.layout,
				panes: metadata.panes,
				tree: metadata.tree ?? null,
				createdAt: now,
				updatedAt: now
			});

	if (!saved) throw new ServiceValidationError(['Could not save workspace layout']);
	void getSessionWorkspaceLayout().refresh();

	return {
		layout: saved.layoutKind,
		panes: saved.panes,
		tree: saved.tree ?? undefined,
		updatedAt: saved.updatedAt.toISOString()
	};
});
