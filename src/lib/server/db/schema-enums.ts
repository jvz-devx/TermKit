import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

export const hostProtocol = pgEnum('host_protocol', ['ssh', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps']);
export const connectionProtocol = pgEnum('connection_protocol', [
	'ssh',
	'rdp',
	'vnc',
	'telnet',
	'ftp',
	'ftps',
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
export const automationTemplateKind = pgEnum('automation_template_kind', [
	'ssh_command',
	'file_transfer',
	'ssh_tunnel',
	'rdp_checklist',
	'operator_note'
]);
export const automationTemplateVisibility = pgEnum('automation_template_visibility', [
	'private',
	'workspace'
]);
export const automationVariableKind = pgEnum('automation_variable_kind', [
	'string',
	'number',
	'boolean',
	'enum',
	'secret_ref',
	'path'
]);
export const backgroundJobKind = pgEnum('background_job_kind', [
	'template_run',
	'bulk_ssh_command',
	'bulk_file_transfer',
	'bulk_host_edit',
	'inventory_check'
]);
export const backgroundJobStatus = pgEnum('background_job_status', [
	'pending',
	'queued',
	'running',
	'cancelling',
	'cancelled',
	'completed',
	'completed_with_errors',
	'failed'
]);
export const jobTargetStatus = pgEnum('job_target_status', [
	'pending',
	'queued',
	'running',
	'succeeded',
	'failed',
	'skipped',
	'cancelling',
	'cancelled',
	'retrying'
]);
export const jobEventSeverity = pgEnum('job_event_severity', ['debug', 'info', 'warning', 'error']);
export const jobReportFormat = pgEnum('job_report_format', ['json', 'csv']);
export const workspacePolicyCapability = pgEnum('workspace_policy_capability', [
	'launch_session',
	'file_transfer',
	'ssh_tunnel',
	'terminal_recording',
	'rdp_clipboard',
	'rdp_audio',
	'automation_template',
	'bulk_job',
	'host_facts'
]);
export const workspacePolicyEffect = pgEnum('workspace_policy_effect', [
	'allow',
	'deny',
	'approval_required',
	'reason_required'
]);
export const approvalRequestStatus = pgEnum('approval_request_status', [
	'pending',
	'approved',
	'rejected',
	'cancelled',
	'expired'
]);
export const hostFactSource = pgEnum('host_fact_source', ['ssh', 'manual', 'import']);
export const hostHealthState = pgEnum('host_health_state', [
	'unknown',
	'healthy',
	'stale',
	'unreachable',
	'auth_failed',
	'degraded',
	'never_used'
]);

export const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};
