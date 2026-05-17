import type {
	SessionLayoutKind,
	SessionPaneKind,
	SessionWorkspaceLayoutMetadata
} from './workspace-layout';

export type SessionLayoutOverrides = {
	layoutOverride: SessionLayoutKind;
	paneKindOverrides: Record<string, SessionPaneKind>;
	paneHostIdOverrides: Record<string, string>;
};

export function layoutOverridesFromMetadata(
	metadata: SessionWorkspaceLayoutMetadata
): SessionLayoutOverrides {
	return {
		layoutOverride: metadata.layout,
		paneKindOverrides: Object.fromEntries(metadata.panes.map((pane) => [pane.id, pane.kind])),
		paneHostIdOverrides: Object.fromEntries(
			metadata.panes.flatMap((pane) => (pane.hostId ? [[pane.id, pane.hostId]] : []))
		)
	};
}
