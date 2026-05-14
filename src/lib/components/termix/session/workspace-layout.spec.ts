import { describe, expect, it } from 'vitest';
import {
	createDefaultSessionLayout,
	normalizeSessionLayout,
	removeSessionPane,
	resizeSessionLayout,
	updateSessionPaneKind,
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

	it('builds deterministic multi-pane defaults for dense protocol workspaces', () => {
		expect(createDefaultSessionLayout('quad', 'rdp', 'host-1').panes).toEqual([
			{ id: 'pane-1', kind: 'rdp', hostId: 'host-1' },
			{ id: 'pane-2', kind: 'ssh', hostId: 'host-1' },
			{ id: 'pane-3', kind: 'sftp', hostId: 'host-1' },
			{ id: 'pane-4', kind: 'vnc', hostId: 'host-1' }
		]);
		expect(createDefaultSessionLayout('two-columns', 'telnet', null).panes).toEqual([
			{ id: 'pane-1', kind: 'telnet', hostId: null },
			{ id: 'pane-2', kind: 'ssh', hostId: null }
		]);
	});

	it('resizes and mutates workspace layout metadata while preserving existing panes', () => {
		const layout = normalizeSessionLayout(
			{
				layout: 'quad',
				panes: [
					{ id: 'one', kind: 'ssh', hostId: 'host-1' },
					{ id: 'two', kind: 'sftp', hostId: 'host-1' },
					{ id: 'three', kind: 'rdp', hostId: 'host-2' },
					{ id: 'four', kind: 'vnc', hostId: 'host-3' }
				]
			},
			'single',
			'ssh',
			'fallback-host'
		);

		const compact = resizeSessionLayout(layout, 'two-rows', 'ssh', 'fallback-host');
		const changed = updateSessionPaneKind(compact, 'two', 'ftp');

		expect(compact).toMatchObject({
			layout: 'two-rows',
			panes: [
				{ id: 'one', kind: 'ssh', hostId: 'host-1' },
				{ id: 'two', kind: 'sftp', hostId: 'host-1' }
			]
		});
		expect(changed.panes[1]).toMatchObject({ id: 'two', kind: 'ftp' });
		expect(changed.updatedAt).toEqual(expect.any(String));
	});
});
