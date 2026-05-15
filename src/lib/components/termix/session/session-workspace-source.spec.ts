import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../SessionWorkspace.svelte', import.meta.url), 'utf8');

describe('session workspace source contracts', () => {
	it('keeps global protocol buttons scoped to single-pane workspaces', () => {
		expect(source).toContain(
			"let isSinglePaneLayout = $derived(activeWorkspaceLayout.layout === 'single')"
		);
		expect(source).toMatch(/\{#if isSinglePaneLayout\}[\s\S]+availableTabs as tab/);
		expect(source).toContain('data-session-workbench-mode="multi-pane"');
	});

	it('keeps layout controls available from the compact workbench bar', () => {
		expect(source).toContain('data-session-workbench-bar');
		expect(source).toContain(
			'<SessionLayoutControls layout={activeWorkspaceLayout.layout} onChange={selectLayout} />'
		);
	});
});
