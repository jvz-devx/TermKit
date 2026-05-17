import { describe, expect, it } from 'vitest';
import {
	attachableLiveSshSessionsForHost,
	isHostKeyTrustFailure,
	liveSshActionTitle,
	liveSshErrorForHost,
	liveSshSessionsForHost,
	sshWelcome
} from './session-workspace-live-ssh';

describe('session workspace live SSH helpers', () => {
	it('filters host sessions and excludes already attached sessions', () => {
		const sessions = [
			{ id: 'a', hostId: 'h1', status: 'detached' },
			{ id: 'b', hostId: 'h1', status: 'detached' },
			{ id: 'c', hostId: 'h2', status: 'detached' }
		] as never;

		expect(liveSshSessionsForHost(sessions, 'h1').map((session) => session.id)).toEqual(['a', 'b']);
		expect(
			attachableLiveSshSessionsForHost({
				sessions,
				attachments: { pane: { session: { id: 'a' } } } as never,
				hostId: 'h1'
			}).map((session) => session.id)
		).toEqual(['b']);
	});

	it('formats live SSH errors and host key checks', () => {
		const error = {
			action: 'attach',
			message: 'host key mismatch',
			hostId: 'h1',
			sessionId: null
		} as const;

		expect(liveSshErrorForHost(error, 'h1')).toBe(error);
		expect(liveSshErrorForHost(error, 'h2')).toBeNull();
		expect(liveSshActionTitle(error)).toBe('Could not attach SSH tab');
		expect(isHostKeyTrustFailure(error)).toBe(true);
	});

	it('builds SSH welcome lines with jump host detail', () => {
		expect(
			sshWelcome({ sshJumpHost: { enabled: true, hostId: 'jump-1' } } as never, 'server.example')[1]
		).toBe('Using jump host jump-1');
	});
});
