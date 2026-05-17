import { describe, expect, it } from 'vitest';
import { hostForWorkspacePane, preferredLiveSshPaneId } from './session-workspace-pane-hosts';

describe('session workspace pane host helpers', () => {
	const hosts = [
		{ id: 'primary', name: 'Primary' },
		{ id: 'other', name: 'Other' }
	] as never;

	it('resolves pane hosts with selected host fallback', () => {
		expect(
			hostForWorkspacePane({
				hosts,
				selectedHost: hosts[0],
				pane: { hostId: 'other' }
			})
		).toBe(hosts[1]);
		expect(
			hostForWorkspacePane({
				hosts,
				selectedHost: hosts[0],
				pane: { hostId: null }
			})
		).toBe(hosts[0]);
	});

	it('prefers an unattached SSH pane for the requested host', () => {
		const panes = [
			{ id: 'one', kind: 'ssh', hostId: 'primary' },
			{ id: 'two', kind: 'ssh', hostId: 'other' },
			{ id: 'three', kind: 'rdp', hostId: 'other' }
		] as never;

		expect(
			preferredLiveSshPaneId({
				panes,
				hosts,
				selectedHost: hosts[0],
				liveSshAttachByPaneId: { one: { session: { id: 'attached' } } } as never,
				hostId: 'other'
			})
		).toBe('two');
	});

	it('falls back to any unattached SSH pane, then any SSH pane', () => {
		const panes = [
			{ id: 'one', kind: 'ssh', hostId: 'primary' },
			{ id: 'two', kind: 'ssh', hostId: 'other' }
		] as never;

		expect(
			preferredLiveSshPaneId({
				panes,
				hosts,
				selectedHost: hosts[0],
				liveSshAttachByPaneId: { one: { session: { id: 'attached' } } } as never,
				hostId: 'missing'
			})
		).toBe('two');
		expect(
			preferredLiveSshPaneId({
				panes,
				hosts,
				selectedHost: hosts[0],
				liveSshAttachByPaneId: {
					one: { session: { id: 'attached-one' } },
					two: { session: { id: 'attached-two' } }
				} as never,
				hostId: 'missing'
			})
		).toBe('one');
	});
});
