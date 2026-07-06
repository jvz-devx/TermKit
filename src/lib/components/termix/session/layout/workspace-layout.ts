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

export const maxSessionPanes = 8;

export type SessionPaneSplitDirection = 'horizontal' | 'vertical';

export type SessionWorkspacePane = {
	id: string;
	kind: SessionPaneKind;
	hostId: string | null;
};

export type SessionPaneTreeNode =
	| {
			type: 'pane';
			paneId: string;
	  }
	| {
			type: 'split';
			direction: SessionPaneSplitDirection;
			children: [SessionPaneTreeNode, SessionPaneTreeNode];
	  };

export type SessionWorkspaceLayoutMetadata = {
	layout: SessionLayoutKind;
	panes: SessionWorkspacePane[];
	tree?: SessionPaneTreeNode;
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
		})),
		tree: createPresetPaneTree(layout)
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
	const sourceTree = normalizePaneTree(input.tree);
	const maxPaneCount = sourceTree ? maxSessionPanes : layoutPaneCounts[layout];
	const panes = Array.from({ length: maxPaneCount }, (_, index) => {
		const fallbackPane =
			defaultLayout.panes[index] ??
			createFallbackPane(index, fallbackKind, fallbackHostId, defaultLayout.panes);
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
	});
	const sourceTreeIsValid =
		sourceTree &&
		treePaneIds(sourceTree).every((paneId) => panes.some((pane) => pane.id === paneId));
	const tree = sourceTreeIsValid ? sourceTree : createPaneTreeForLayout(layout, panes);

	return {
		layout,
		panes: panesForTree(panes, tree, layout),
		tree,
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
		tree: createPaneTreeForLayout(
			layout,
			Array.from({ length: count }, (_, index) => current.panes[index] ?? defaults[index])
		),
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
		const panes = [
			remaining[0] ?? {
				id: 'pane-1',
				kind: fallbackKind,
				hostId: fallbackHostId
			}
		];
		return {
			layout: 'single',
			panes,
			tree: createPaneTreeForLayout('single', panes),
			updatedAt: new Date().toISOString()
		};
	}

	const layout: SessionLayoutKind =
		remaining.length >= 4 ? 'quad' : remaining.length === 3 ? 'three' : 'two-columns';
	const currentTree = current.tree ?? createPaneTreeForLayout(current.layout, current.panes);
	const tree = collapsePaneFromTree(currentTree, paneId);
	const nextPanes =
		tree && treePaneIds(tree).every((id) => remaining.some((pane) => pane.id === id))
			? remaining
			: remaining.slice(0, layoutPaneCounts[layout]);
	return {
		layout,
		panes: nextPanes,
		tree:
			tree && treePaneIds(tree).every((id) => remaining.some((pane) => pane.id === id))
				? tree
				: createPaneTreeForLayout(layout, nextPanes),
		updatedAt: new Date().toISOString()
	};
}

export function splitSessionPane(
	current: SessionWorkspaceLayoutMetadata,
	paneId: string,
	direction: SessionPaneSplitDirection,
	fallbackKind: SessionPaneKind,
	fallbackHostId: string | null = null
): SessionWorkspaceLayoutMetadata {
	if (
		!current.panes.some((pane) => pane.id === paneId) ||
		current.panes.length >= maxSessionPanes
	) {
		return current;
	}

	const newPane: SessionWorkspacePane = {
		id: nextPaneId(current.panes),
		kind: fallbackKind,
		hostId: fallbackHostId
	};
	const tree = replacePaneWithSplit(
		current.tree ?? createPaneTreeForLayout(current.layout, current.panes),
		paneId,
		direction,
		newPane.id
	);
	if (!tree) return current;

	return {
		layout: layoutForPaneCount(current.panes.length + 1),
		panes: [...current.panes, newPane],
		tree,
		updatedAt: new Date().toISOString()
	};
}

export function createPresetPaneTree(layout: SessionLayoutKind): SessionPaneTreeNode {
	if (layout === 'single') return paneNode(1);
	if (layout === 'two-columns') {
		return splitNode('horizontal', paneNode(1), paneNode(2));
	}
	if (layout === 'two-rows') {
		return splitNode('vertical', paneNode(1), paneNode(2));
	}
	if (layout === 'three') {
		return splitNode('horizontal', paneNode(1), splitNode('vertical', paneNode(2), paneNode(3)));
	}
	return splitNode(
		'horizontal',
		splitNode('vertical', paneNode(1), paneNode(3)),
		splitNode('vertical', paneNode(2), paneNode(4))
	);
}

export function createPaneTreeForLayout(
	layout: SessionLayoutKind,
	panes: SessionWorkspacePane[]
): SessionPaneTreeNode {
	const paneAt = (index: number): SessionPaneTreeNode => ({
		type: 'pane',
		paneId: panes[index - 1]?.id ?? `pane-${index}`
	});
	if (layout === 'single') return paneAt(1);
	if (layout === 'two-columns') return splitNode('horizontal', paneAt(1), paneAt(2));
	if (layout === 'two-rows') return splitNode('vertical', paneAt(1), paneAt(2));
	if (layout === 'three') {
		return splitNode('horizontal', paneAt(1), splitNode('vertical', paneAt(2), paneAt(3)));
	}
	return splitNode(
		'horizontal',
		splitNode('vertical', paneAt(1), paneAt(3)),
		splitNode('vertical', paneAt(2), paneAt(4))
	);
}

function defaultSecondaryPaneKinds(primaryKind: SessionPaneKind): SessionPaneKind[] {
	if (primaryKind === 'ssh') return ['sftp', 'ssh-tunnel', 'telnet'];
	if (primaryKind === 'rdp') return ['ssh', 'sftp', 'vnc'];
	if (primaryKind === 'vnc') return ['ssh', 'sftp', 'rdp'];
	if (primaryKind === 'telnet') return ['ssh', 'sftp', 'ftp'];
	return ['ssh', 'sftp', 'rdp'];
}

function createFallbackPane(
	index: number,
	fallbackKind: SessionPaneKind,
	fallbackHostId: string | null,
	existing: SessionWorkspacePane[]
): SessionWorkspacePane {
	return existing[index] ?? { id: `pane-${index + 1}`, kind: fallbackKind, hostId: fallbackHostId };
}

function panesForTree(
	panes: SessionWorkspacePane[],
	tree: SessionPaneTreeNode | null,
	layout: SessionLayoutKind
): SessionWorkspacePane[] {
	if (!tree) return panes.slice(0, layoutPaneCounts[layout]);

	const visiblePaneIds = new Set(treePaneIds(tree));
	return panes.filter((pane) => visiblePaneIds.has(pane.id)).slice(0, maxSessionPanes);
}

function normalizePaneTree(value: unknown, depth = 0): SessionPaneTreeNode | null {
	if (!isRecord(value) || depth > maxSessionPanes) return null;
	if (value.type === 'pane' && typeof value.paneId === 'string' && value.paneId) {
		return { type: 'pane', paneId: value.paneId };
	}
	if (
		value.type === 'split' &&
		(value.direction === 'horizontal' || value.direction === 'vertical') &&
		Array.isArray(value.children) &&
		value.children.length === 2
	) {
		const left = normalizePaneTree(value.children[0], depth + 1);
		const right = normalizePaneTree(value.children[1], depth + 1);
		if (!left || !right) return null;
		return { type: 'split', direction: value.direction, children: [left, right] };
	}
	return null;
}

function treePaneIds(tree: SessionPaneTreeNode): string[] {
	if (tree.type === 'pane') return [tree.paneId];
	return tree.children.flatMap(treePaneIds);
}

function paneNode(index: number): SessionPaneTreeNode {
	return { type: 'pane', paneId: `pane-${index}` };
}

function splitNode(
	direction: SessionPaneSplitDirection,
	left: SessionPaneTreeNode,
	right: SessionPaneTreeNode
): SessionPaneTreeNode {
	return { type: 'split', direction, children: [left, right] };
}

function replacePaneWithSplit(
	tree: SessionPaneTreeNode,
	paneId: string,
	direction: SessionPaneSplitDirection,
	newPaneId: string
): SessionPaneTreeNode | null {
	if (tree.type === 'pane') {
		return tree.paneId === paneId
			? splitNode(direction, { type: 'pane', paneId }, { type: 'pane', paneId: newPaneId })
			: null;
	}

	const left = replacePaneWithSplit(tree.children[0], paneId, direction, newPaneId);
	if (left) return { ...tree, children: [left, tree.children[1]] };
	const right = replacePaneWithSplit(tree.children[1], paneId, direction, newPaneId);
	if (right) return { ...tree, children: [tree.children[0], right] };
	return null;
}

function collapsePaneFromTree(
	tree: SessionPaneTreeNode,
	paneId: string
): SessionPaneTreeNode | null {
	if (tree.type === 'pane') return tree.paneId === paneId ? null : tree;

	const left = collapsePaneFromTree(tree.children[0], paneId);
	const right = collapsePaneFromTree(tree.children[1], paneId);
	if (!left && !right) return null;
	if (!left) return right;
	if (!right) return left;
	return { ...tree, children: [left, right] };
}

function nextPaneId(panes: SessionWorkspacePane[]): string {
	const existing = new Set(panes.map((pane) => pane.id));
	for (let index = panes.length + 1; index <= maxSessionPanes + 1; index += 1) {
		const candidate = `pane-${index}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `pane-${Date.now()}`;
}

function layoutForPaneCount(count: number): SessionLayoutKind {
	if (count <= 1) return 'single';
	if (count === 2) return 'two-columns';
	if (count === 3) return 'three';
	return 'quad';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
