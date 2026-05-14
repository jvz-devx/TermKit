import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
	authIdentities,
	authIdentityProvider,
	approvalRequestStatus,
	approvalRequests,
	automationTemplateKind,
	automationTemplateVisibility,
	automationTemplates,
	automationVariableKind,
	backgroundJobKind,
	backgroundJobStatus,
	backgroundJobs,
	connectionProtocol,
	connectionSessions,
	credentials,
	commandSnippets,
	fileBookmarks,
	fileTransferProtocol,
	ftpsHostSettings,
	ftpsMode,
	hostFactSource,
	hostFacts,
	hostHealth,
	hostHealthState,
	hostProtocol,
	hosts,
	jobEventSeverity,
	jobEvents,
	jobReportFormat,
	jobReports,
	jobTargetStatus,
	jobTargets,
	operationReasons,
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
	workspacePolicies,
	workspacePolicyCapability,
	workspacePolicyEffect,
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

	it('defines the V6 automation and job enum values', () => {
		expect.assertions(7);

		expect(automationTemplateKind.enumValues).toEqual([
			'ssh_command',
			'file_transfer',
			'ssh_tunnel',
			'rdp_checklist',
			'operator_note'
		]);
		expect(automationTemplateVisibility.enumValues).toEqual(['private', 'workspace']);
		expect(automationVariableKind.enumValues).toEqual([
			'string',
			'number',
			'boolean',
			'enum',
			'secret_ref',
			'path'
		]);
		expect(backgroundJobKind.enumValues).toEqual([
			'template_run',
			'bulk_ssh_command',
			'bulk_file_transfer',
			'bulk_host_edit',
			'inventory_check'
		]);
		expect(backgroundJobStatus.enumValues).toEqual([
			'pending',
			'queued',
			'running',
			'cancelling',
			'cancelled',
			'completed',
			'completed_with_errors',
			'failed'
		]);
		expect(jobTargetStatus.enumValues).toEqual([
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
		expect(jobEventSeverity.enumValues).toEqual(['debug', 'info', 'warning', 'error']);
	});

	it('defines the V6 governance and host intelligence enum values', () => {
		expect.assertions(6);

		expect(jobReportFormat.enumValues).toEqual(['json', 'csv']);
		expect(workspacePolicyCapability.enumValues).toEqual([
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
		expect(workspacePolicyEffect.enumValues).toEqual([
			'allow',
			'deny',
			'approval_required',
			'reason_required'
		]);
		expect(approvalRequestStatus.enumValues).toEqual([
			'pending',
			'approved',
			'rejected',
			'cancelled',
			'expired'
		]);
		expect(hostFactSource.enumValues).toEqual(['ssh', 'manual', 'import']);
		expect(hostHealthState.enumValues).toEqual([
			'unknown',
			'healthy',
			'stale',
			'unreachable',
			'auth_failed',
			'degraded',
			'never_used'
		]);
	});

	it('uses the expected core table names', () => {
		expect.assertions(28);

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
		expect(getTableName(automationTemplates)).toBe('automation_templates');
		expect(getTableName(backgroundJobs)).toBe('background_jobs');
		expect(getTableName(jobTargets)).toBe('job_targets');
		expect(getTableName(jobEvents)).toBe('job_events');
		expect(getTableName(jobReports)).toBe('job_reports');
		expect(getTableName(workspacePolicies)).toBe('workspace_policies');
		expect(getTableName(approvalRequests)).toBe('approval_requests');
		expect(getTableName(operationReasons)).toBe('operation_reasons');
		expect(getTableName(hostFacts)).toBe('host_facts');
		expect(getTableName(hostHealth)).toBe('host_health');
	});
});
