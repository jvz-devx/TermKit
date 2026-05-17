import type { BadgeVariant } from '$lib/components/ui/badge';
import type { WorkspaceProtocol } from './session-workspace-protocols';
import type { SessionLayoutKind, SessionPaneKind } from './workspace-layout';

export const workspaceLayoutLabels: Record<SessionLayoutKind, string> = {
	single: 'Single pane',
	'two-columns': 'Two columns',
	'two-rows': 'Two rows',
	three: 'Three panes',
	quad: '2x2 grid'
};

export function workspacePaneSummary({
	isSinglePaneLayout,
	activeProtocol,
	workspaceLayoutLabel
}: {
	isSinglePaneLayout: boolean;
	activeProtocol: WorkspaceProtocol;
	workspaceLayoutLabel: string;
}) {
	return isSinglePaneLayout
		? `${activeProtocol.toUpperCase()} session`
		: `${workspaceLayoutLabel} workspace`;
}

export function workspacePaneKinds(kinds: SessionPaneKind[]) {
	return [
		...new Set(kinds.map((kind) => (kind === 'ssh-tunnel' ? 'SSH tunnel' : kind.toUpperCase())))
	].join(' + ');
}

export function workspaceStatus({
	hasSelectedHost,
	hasLiveSshError,
	sessionPaused,
	activeProtocol,
	attachedLiveSshPaneCount,
	detachedSshCount
}: {
	hasSelectedHost: boolean;
	hasLiveSshError: boolean;
	sessionPaused: boolean;
	activeProtocol: WorkspaceProtocol;
	attachedLiveSshPaneCount: number;
	detachedSshCount: number;
}) {
	if (!hasSelectedHost) return 'No host';
	if (hasLiveSshError) return 'Failure';
	if (sessionPaused) return 'Closed';
	if (activeProtocol === 'ssh' && attachedLiveSshPaneCount) return 'Attached';
	if (activeProtocol === 'ssh' && detachedSshCount) return `${detachedSshCount} detached`;
	return 'Ready';
}

export function workspaceStatusVariant({
	hasLiveSshError,
	sessionPaused,
	activeProtocol,
	attachedLiveSshPaneCount
}: {
	hasLiveSshError: boolean;
	sessionPaused: boolean;
	activeProtocol: WorkspaceProtocol;
	attachedLiveSshPaneCount: number;
}): BadgeVariant {
	if (hasLiveSshError) return 'destructive';
	if (sessionPaused) return 'outline';
	if (activeProtocol === 'ssh' && attachedLiveSshPaneCount) return 'secondary';
	return 'outline';
}
