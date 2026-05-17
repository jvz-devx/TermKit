import { describe, expect, it } from 'vitest';
import { layoutOverridesFromMetadata } from './session-workspace-layout-overrides';

describe('session workspace layout overrides', () => {
	it('builds local override maps from persisted layout metadata', () => {
		expect(
			layoutOverridesFromMetadata({
				layout: 'two-columns',
				panes: [
					{ id: 'pane-1', kind: 'ssh', hostId: 'host-1' },
					{ id: 'pane-2', kind: 'rdp', hostId: null }
				]
			})
		).toEqual({
			layoutOverride: 'two-columns',
			paneKindOverrides: {
				'pane-1': 'ssh',
				'pane-2': 'rdp'
			},
			paneHostIdOverrides: {
				'pane-1': 'host-1'
			}
		});
	});
});
