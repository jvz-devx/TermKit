export const sessionLayoutKinds = ['single', 'two-columns', 'two-rows', 'three', 'quad'] as const;

export type SessionLayoutKind = (typeof sessionLayoutKinds)[number];

export const sessionPaneKinds = [
	'ssh',
	'sftp',
	'rdp',
	'vnc',
	'telnet',
	'ftp',
	'ftps',
	'ssh-tunnel'
] as const;

export type SessionPaneKind = (typeof sessionPaneKinds)[number];

export type SessionWorkspacePane = {
	id: string;
	kind: SessionPaneKind;
	hostId: string | null;
};

export type SessionWorkspaceLayoutMetadata = {
	layout: SessionLayoutKind;
	panes: SessionWorkspacePane[];
	updatedAt?: string;
};

export const layoutPaneCounts: Record<SessionLayoutKind, number> = {
	single: 1,
	'two-columns': 2,
	'two-rows': 2,
	three: 3,
	quad: 4
};

export function isSessionLayoutKind(value: unknown): value is SessionLayoutKind {
	return typeof value === 'string' && sessionLayoutKinds.includes(value as SessionLayoutKind);
}

export function isSessionPaneKind(value: unknown): value is SessionPaneKind {
	return typeof value === 'string' && sessionPaneKinds.includes(value as SessionPaneKind);
}

export function createDefaultSessionLayout(
	layout: SessionLayoutKind,
	primaryKind: SessionPaneKind,
	hostId: string | null = null
): SessionWorkspaceLayoutMetadata {
	const secondaryKinds = defaultSecondaryPaneKinds(primaryKind);

	return {
		layout,
		panes: Array.from({ length: layoutPaneCounts[layout] }, (_, index) => ({
			id: `pane-${index + 1}`,
			kind: index === 0 ? primaryKind : (secondaryKinds[index - 1] ?? primaryKind),
			hostId
		}))
	};
}

export function normalizeSessionLayout(
	value: unknown,
	fallbackLayout: SessionLayoutKind,
	fallbackKind: SessionPaneKind,
	fallbackHostId: string | null = null
): SessionWorkspaceLayoutMetadata {
	const input = isRecord(value) ? value : {};
	const layout = isSessionLayoutKind(input.layout) ? input.layout : fallbackLayout;
	const sourcePanes = Array.isArray(input.panes) ? input.panes : [];
	const defaultLayout = createDefaultSessionLayout(layout, fallbackKind, fallbackHostId);

	return {
		layout,
		panes: defaultLayout.panes.map((fallbackPane, index) => {
			const sourcePane = sourcePanes[index];
			if (!isRecord(sourcePane)) return fallbackPane;

			return {
				id: typeof sourcePane.id === 'string' && sourcePane.id ? sourcePane.id : fallbackPane.id,
				kind: isSessionPaneKind(sourcePane.kind) ? sourcePane.kind : fallbackPane.kind,
				hostId:
					typeof sourcePane.hostId === 'string' && sourcePane.hostId
						? sourcePane.hostId
						: fallbackPane.hostId
			};
		}),
		updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined
	};
}

export function resizeSessionLayout(
	current: SessionWorkspaceLayoutMetadata,
	layout: SessionLayoutKind,
	fallbackKind: SessionPaneKind,
	fallbackHostId: string | null = null
): SessionWorkspaceLayoutMetadata {
	const count = layoutPaneCounts[layout];
	const defaults = createDefaultSessionLayout(layout, fallbackKind, fallbackHostId).panes;

	return {
		layout,
		panes: Array.from({ length: count }, (_, index) => current.panes[index] ?? defaults[index]),
		updatedAt: new Date().toISOString()
	};
}

export function updateSessionPaneKind(
	current: SessionWorkspaceLayoutMetadata,
	paneId: string,
	kind: SessionPaneKind
): SessionWorkspaceLayoutMetadata {
	return {
		...current,
		panes: current.panes.map((pane) => (pane.id === paneId ? { ...pane, kind } : pane)),
		updatedAt: new Date().toISOString()
	};
}

export function updateSessionPaneHost(
	current: SessionWorkspaceLayoutMetadata,
	paneId: string,
	hostId: string
): SessionWorkspaceLayoutMetadata {
	return {
		...current,
		panes: current.panes.map((pane) => (pane.id === paneId ? { ...pane, hostId } : pane)),
		updatedAt: new Date().toISOString()
	};
}

export function removeSessionPane(
	current: SessionWorkspaceLayoutMetadata,
	paneId: string,
	fallbackKind: SessionPaneKind,
	fallbackHostId: string | null = null
): SessionWorkspaceLayoutMetadata {
	const remaining = current.panes.filter((pane) => pane.id !== paneId);
	if (remaining.length <= 1) {
		return {
			layout: 'single',
			panes: [
				remaining[0] ?? {
					id: 'pane-1',
					kind: fallbackKind,
					hostId: fallbackHostId
				}
			],
			updatedAt: new Date().toISOString()
		};
	}

	const layout: SessionLayoutKind =
		remaining.length >= 4 ? 'quad' : remaining.length === 3 ? 'three' : 'two-columns';
	const count = layoutPaneCounts[layout];
	return {
		layout,
		panes: remaining.slice(0, count),
		updatedAt: new Date().toISOString()
	};
}

function defaultSecondaryPaneKinds(primaryKind: SessionPaneKind): SessionPaneKind[] {
	if (primaryKind === 'ssh') return ['sftp', 'ssh-tunnel', 'telnet'];
	if (primaryKind === 'rdp') return ['ssh', 'sftp', 'vnc'];
	if (primaryKind === 'vnc') return ['ssh', 'sftp', 'rdp'];
	if (primaryKind === 'telnet') return ['ssh', 'sftp', 'ftp'];
	return ['ssh', 'sftp', 'rdp'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
