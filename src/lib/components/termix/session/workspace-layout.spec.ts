import { describe, expect, it } from 'vitest';
import {
	normalizeSessionLayout,
	removeSessionPane,
	updateSessionPaneHost
} from './workspace-layout';

describe('session workspace layout metadata', () => {
	it('preserves pane host ids and supports per-pane host replacement', () => {
		const layout = normalizeSessionLayout(
			{
				layout: 'two-columns',
				panes: [
					{ id: 'left', kind: 'ssh', hostId: 'host-1' },
					{ id: 'right', kind: 'ftp', hostId: 'host-2' }
				]
			},
			'single',
			'ssh',
			'fallback-host'
		);

		expect(layout.panes).toEqual([
			{ id: 'left', kind: 'ssh', hostId: 'host-1' },
			{ id: 'right', kind: 'ftp', hostId: 'host-2' }
		]);
		expect(updateSessionPaneHost(layout, 'right', 'host-3').panes[1]).toMatchObject({
			hostId: 'host-3'
		});
	});

	it('compacts the layout when a pane is closed', () => {
		const layout = normalizeSessionLayout(
			{
				layout: 'two-columns',
				panes: [
					{ id: 'left', kind: 'ssh', hostId: 'host-1' },
					{ id: 'right', kind: 'sftp', hostId: 'host-1' }
				]
			},
			'single',
			'ssh',
			'host-1'
		);

		expect(removeSessionPane(layout, 'right', 'ssh', 'host-1')).toMatchObject({
			layout: 'single',
			panes: [{ id: 'left', kind: 'ssh', hostId: 'host-1' }]
		});
	});
});
