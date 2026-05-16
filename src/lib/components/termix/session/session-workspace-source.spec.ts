import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../SessionWorkspace.svelte', import.meta.url), 'utf8');
const controllerSource = readFileSync(
	new URL('./session-workspace-controller.svelte.ts', import.meta.url),
	'utf8'
);
const workbenchBarSource = readFileSync(
	new URL('./SessionWorkbenchBar.svelte', import.meta.url),
	'utf8'
);

describe('session workspace source contracts', () => {
	it('keeps global protocol buttons scoped to single-pane workspaces', () => {
		expect(controllerSource).toContain(
			"const isSinglePaneLayout = $derived(activeWorkspaceLayout.layout === 'single')"
		);
		expect(source).toContain('<SessionWorkbenchBar');
		expect(workbenchBarSource).toMatch(/\{#if isSinglePaneLayout\}[\s\S]+availableTabs as tab/);
		expect(workbenchBarSource).toContain('data-session-workbench-mode="multi-pane"');
	});

	it('keeps layout controls available from the compact workbench bar', () => {
		expect(workbenchBarSource).toContain('data-session-workbench-bar');
		expect(workbenchBarSource).toContain(
			'<SessionLayoutControls {layout} onChange={onSelectLayout} />'
		);
	});
});
