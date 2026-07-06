import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
	authIdentities,
	authIdentityProvider,
	connectionProtocol,
	connectionSessions,
	credentials,
	commandSnippets,
	fileBookmarks,
	fileTransferProtocol,
	ftpsHostSettings,
	ftpsMode,
	hostProtocol,
	hosts,
	rdpHostSettings,
	sessionTickets,
	sessions,
	sshAttachTickets,
	sshLiveSessions,
	sshTunnelProfiles,
	sshTunnelSessions,
	sshTunnelSessionStatus,
	sshLiveSessionStatus,
	terminalPreferences,
	terminalRecordingStatus,
	terminalRecordings,
	workspaceLayouts,
	users
} from './schema';

describe('core schema', () => {
	it('defines the V4 host protocol enum values', () => {
		expect.assertions(1);

		expect(hostProtocol.enumValues).toEqual(['ssh', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps']);
	});

	it('defines the V4 connection protocol enum values', () => {
		expect.assertions(1);

		expect(connectionProtocol.enumValues).toEqual([
			'ssh',
			'rdp',
			'vnc',
			'telnet',
			'ftp',
			'ftps',
			'sftp',
			'ssh_tunnel'
		]);
	});

	it('defines the V2 auth identity provider enum values', () => {
		expect.assertions(1);

		expect(authIdentityProvider.enumValues).toEqual(['microsoft']);
	});

	it('defines the V2 live SSH session status enum values', () => {
		expect.assertions(1);

		expect(sshLiveSessionStatus.enumValues).toEqual([
			'starting',
			'attached',
			'detached',
			'ended',
			'failed',
			'stale'
		]);
	});

	it('defines the V4 SSH tunnel session status enum values', () => {
		expect.assertions(1);

		expect(sshTunnelSessionStatus.enumValues).toEqual([
			'starting',
			'active',
			'idle',
			'ended',
			'failed',
			'expired'
		]);
	});

	it('defines the V5 terminal recording status enum values', () => {
		expect.assertions(1);

		expect(terminalRecordingStatus.enumValues).toEqual([
			'recording',
			'completed',
			'failed',
			'expired'
		]);
	});

	it('defines the V5 FTPS mode enum values', () => {
		expect.assertions(1);

		expect(ftpsMode.enumValues).toEqual(['explicit', 'implicit']);
	});

	it('defines the V5 file transfer protocol enum values', () => {
		expect.assertions(1);

		expect(fileTransferProtocol.enumValues).toEqual(['sftp', 'ftp', 'ftps']);
	});

	it('uses the expected core table names', () => {
		expect.assertions(18);

		expect(getTableName(users)).toBe('users');
		expect(getTableName(authIdentities)).toBe('auth_identities');
		expect(getTableName(sessions)).toBe('sessions');
		expect(getTableName(hosts)).toBe('hosts');
		expect(getTableName(credentials)).toBe('credentials');
		expect(getTableName(connectionSessions)).toBe('connection_sessions');
		expect(getTableName(sessionTickets)).toBe('session_tickets');
		expect(getTableName(sshTunnelProfiles)).toBe('ssh_tunnel_profiles');
		expect(getTableName(sshTunnelSessions)).toBe('ssh_tunnel_sessions');
		expect(getTableName(workspaceLayouts)).toBe('workspace_layouts');
		expect(getTableName(sshLiveSessions)).toBe('ssh_live_sessions');
		expect(getTableName(sshAttachTickets)).toBe('ssh_attach_tickets');
		expect(getTableName(terminalPreferences)).toBe('terminal_preferences');
		expect(getTableName(commandSnippets)).toBe('command_snippets');
		expect(getTableName(terminalRecordings)).toBe('terminal_recordings');
		expect(getTableName(fileBookmarks)).toBe('file_bookmarks');
		expect(getTableName(ftpsHostSettings)).toBe('ftps_host_settings');
		expect(getTableName(rdpHostSettings)).toBe('rdp_host_settings');
	});
});
