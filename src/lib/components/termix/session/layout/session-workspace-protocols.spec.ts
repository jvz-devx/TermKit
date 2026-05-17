import { describe, expect, it, vi } from 'vitest';
import {
	canAttachLiveSshSession,
	isPaneProtocolAvailable,
	isWorkspaceProtocol,
	protocolsForHost
} from './session-workspace-protocols';

describe('session workspace protocols', () => {
	it('expands SSH hosts to SSH-adjacent workspace protocols', () => {
		expect(protocolsForHost({ protocol: 'ssh' } as never)).toEqual(['ssh', 'sftp', 'ssh-tunnel']);
		expect(protocolsForHost({ protocol: 'rdp' } as never)).toEqual(['rdp']);
	});

	it('validates workspace and pane protocols', () => {
		expect(isWorkspaceProtocol('ssh-tunnel')).toBe(true);
		expect(isWorkspaceProtocol('http')).toBe(false);
		expect(isPaneProtocolAvailable({ protocol: 'ssh' } as never, 'sftp')).toBe(true);
		expect(isPaneProtocolAvailable({ protocol: 'rdp' } as never, 'sftp')).toBe(false);
	});

	it('rejects expired live SSH sessions', () => {
		vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
		expect(
			canAttachLiveSshSession({
				status: 'detached',
				expiresAt: '2026-01-01T00:00:00.000Z'
			} as never)
		).toBe(false);
		expect(canAttachLiveSshSession({ status: 'starting' } as never)).toBe(true);
		vi.useRealTimers();
	});
});
