import type { WorkspaceProtocol } from './session-workspace-protocols';
import { isWorkspaceProtocol } from './session-workspace-protocols';

const lastProtocolStoragePrefix = 'termixkit:last-protocol:';

export function rememberedWorkspaceProtocol({
	storage,
	hostId,
	enabled
}: {
	storage: Storage | null;
	hostId: string;
	enabled: boolean;
}): WorkspaceProtocol | null {
	if (!storage || !enabled) return null;

	const value = storage.getItem(`${lastProtocolStoragePrefix}${hostId}`);
	return value && isWorkspaceProtocol(value) ? value : null;
}

export function rememberWorkspaceProtocol({
	storage,
	hostId,
	protocol,
	enabled
}: {
	storage: Storage | null;
	hostId: string;
	protocol: WorkspaceProtocol;
	enabled: boolean;
}) {
	if (!storage || !enabled) return;
	storage.setItem(`${lastProtocolStoragePrefix}${hostId}`, protocol);
}
