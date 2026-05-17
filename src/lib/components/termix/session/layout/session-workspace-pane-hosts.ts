import type { HostSummary } from '$lib/remotes/hosts.remote';
import type { LiveSshAttach } from '$lib/remotes/sessions.remote';
import type { SessionWorkspacePane } from './workspace-layout';

export function hostForWorkspacePane({
	hosts,
	selectedHost,
	pane
}: {
	hosts: HostSummary[];
	selectedHost: HostSummary | null;
	pane: Pick<SessionWorkspacePane, 'hostId'>;
}) {
	return hosts.find((host) => host.id === pane.hostId) ?? selectedHost;
}

export function preferredLiveSshPaneId({
	panes,
	hosts,
	selectedHost,
	liveSshAttachByPaneId,
	hostId
}: {
	panes: Pick<SessionWorkspacePane, 'id' | 'kind' | 'hostId'>[];
	hosts: HostSummary[];
	selectedHost: HostSummary | null;
	liveSshAttachByPaneId: Record<string, LiveSshAttach>;
	hostId: string;
}) {
	const matchingPane = panes.find((pane) => {
		if (pane.kind !== 'ssh') return false;
		if (liveSshAttachByPaneId[pane.id]) return false;
		return hostForWorkspacePane({ hosts, selectedHost, pane })?.id === hostId;
	});
	if (matchingPane) return matchingPane.id;

	return (
		panes.find((pane) => pane.kind === 'ssh' && !liveSshAttachByPaneId[pane.id])?.id ??
		panes.find((pane) => pane.kind === 'ssh')?.id ??
		null
	);
}
