import { describe, expect, it } from 'vitest';
import {
	workspacePaneKinds,
	workspacePaneSummary,
	workspaceStatus,
	workspaceStatusVariant
} from './session-workspace-status';

describe('session workspace status helpers', () => {
	it('formats pane summaries and protocol kinds', () => {
		expect(
			workspacePaneSummary({
				isSinglePaneLayout: true,
				activeProtocol: 'ssh',
				workspaceLayoutLabel: 'Single pane'
			})
		).toBe('SSH session');
		expect(
			workspacePaneSummary({
				isSinglePaneLayout: false,
				activeProtocol: 'rdp',
				workspaceLayoutLabel: 'Two columns'
			})
		).toBe('Two columns workspace');
		expect(workspacePaneKinds(['ssh', 'sftp', 'ssh-tunnel', 'ssh'])).toBe(
			'SSH + SFTP + SSH tunnel'
		);
	});

	it('prioritizes status copy by workspace state', () => {
		const ready = {
			hasSelectedHost: true,
			hasLiveSshError: false,
			sessionPaused: false,
			activeProtocol: 'ssh' as const,
			attachedLiveSshPaneCount: 0,
			detachedSshCount: 0
		};

		expect(workspaceStatus({ ...ready, hasSelectedHost: false })).toBe('No host');
		expect(workspaceStatus({ ...ready, hasLiveSshError: true })).toBe('Failure');
		expect(workspaceStatus({ ...ready, sessionPaused: true })).toBe('Closed');
		expect(workspaceStatus({ ...ready, attachedLiveSshPaneCount: 1 })).toBe('Attached');
		expect(workspaceStatus({ ...ready, detachedSshCount: 2 })).toBe('2 detached');
		expect(workspaceStatus(ready)).toBe('Ready');
	});

	it('matches status variants to the visible state', () => {
		expect(
			workspaceStatusVariant({
				hasLiveSshError: true,
				sessionPaused: false,
				activeProtocol: 'ssh',
				attachedLiveSshPaneCount: 0
			})
		).toBe('destructive');
		expect(
			workspaceStatusVariant({
				hasLiveSshError: false,
				sessionPaused: false,
				activeProtocol: 'ssh',
				attachedLiveSshPaneCount: 1
			})
		).toBe('secondary');
		expect(
			workspaceStatusVariant({
				hasLiveSshError: false,
				sessionPaused: true,
				activeProtocol: 'ssh',
				attachedLiveSshPaneCount: 1
			})
		).toBe('outline');
	});
});
