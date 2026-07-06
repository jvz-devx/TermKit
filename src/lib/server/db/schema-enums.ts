import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

export const hostProtocol = pgEnum('host_protocol', ['ssh', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps']);
export const connectionProtocol = pgEnum('connection_protocol', [
	'ssh',
	'rdp',
	'vnc',
	'telnet',
	'ftp',
	'ftps',
	'sftp',
	'ssh_tunnel'
]);
export const credentialKind = pgEnum('credential_kind', ['password', 'ssh_key', 'rdp_password']);
export const authIdentityProvider = pgEnum('auth_identity_provider', ['microsoft']);
export const workspaceMemberRole = pgEnum('workspace_member_role', ['owner', 'member']);
export const connectionSessionStatus = pgEnum('connection_session_status', [
	'starting',
	'active',
	'ended',
	'failed'
]);
export const sshTunnelSessionStatus = pgEnum('ssh_tunnel_session_status', [
	'starting',
	'active',
	'idle',
	'ended',
	'failed',
	'expired'
]);
export const sshLiveSessionStatus = pgEnum('ssh_live_session_status', [
	'starting',
	'attached',
	'detached',
	'ended',
	'failed',
	'stale'
]);
export const terminalRecordingStatus = pgEnum('terminal_recording_status', [
	'recording',
	'completed',
	'failed',
	'expired'
]);
export const ftpsMode = pgEnum('ftps_mode', ['explicit', 'implicit']);
export const fileTransferProtocol = pgEnum('file_transfer_protocol', ['sftp', 'ftp', 'ftps']);

export const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};
