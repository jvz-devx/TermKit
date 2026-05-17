import { describe, expect, it } from 'vitest';
import { InMemoryTermixServicesRepository } from './index';
import { InMemoryV5ResourcesRepository } from '../v5-resources';
import { InMemoryV6ResourcesRepository } from '../v6-resources';
import {
	approvalRequest,
	automationTemplate,
	backgroundJob,
	connectionSessionPatch,
	credential,
	host,
	hostFacts,
	hostHealth,
	jobEvent,
	jobReport,
	jobTarget,
	membership,
	operationReason,
	session,
	sshAttachTicket,
	sshLiveSession,
	sshTunnelProfile,
	sshTunnelSession,
	terminalRecording,
	ticket,
	workspace,
	workspacePolicy
} from './repository-test-helpers';

describe('InMemoryTermixServicesRepository filtering and mapping', () => {
	it('separates private rows from workspace-visible host and credential rows', async () => {
		expect.assertions(8);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createWorkspace(workspace({ id: 'workspace-1', name: 'Primary Ops' }));
		await repository.createWorkspace(workspace({ id: 'workspace-2', name: 'Other Ops' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'owner-member', workspaceId: 'workspace-1', userId: 'owner-1' })
		);
		await repository.createWorkspaceMembership(
			membership({ id: 'viewer-member', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createWorkspaceMembership(
			membership({ id: 'other-member', workspaceId: 'workspace-2', userId: 'other-1' })
		);
		await repository.createHost(host({ id: 'owner-private-host', userId: 'owner-1' }));
		await repository.createHost(host({ id: 'member-private-host', userId: 'member-1' }));
		await repository.createHost(
			host({ id: 'workspace-host', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createHost(
			host({ id: 'other-workspace-host', userId: 'other-1', workspaceId: 'workspace-2' })
		);
		await repository.createCredential(
			credential({ id: 'owner-private-credential', userId: 'owner-1' })
		);
		await repository.createCredential(
			credential({ id: 'workspace-credential', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createCredential(
			credential({
				id: 'other-workspace-credential',
				userId: 'other-1',
				workspaceId: 'workspace-2'
			})
		);

		await expect(repository.listHosts('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'member-private-host', workspaceId: null }),
			expect.objectContaining({
				id: 'workspace-host',
				userId: 'owner-1',
				workspaceId: 'workspace-1'
			})
		]);
		await expect(repository.listCredentials('member-1')).resolves.toEqual([
			expect.objectContaining({
				id: 'workspace-credential',
				userId: 'owner-1',
				workspaceId: 'workspace-1'
			})
		]);
		await expect(repository.getHost('member-1', 'owner-private-host')).resolves.toBeNull();
		await expect(
			repository.getCredential('member-1', 'owner-private-credential')
		).resolves.toBeNull();
		await expect(repository.getHost('member-1', 'other-workspace-host')).resolves.toBeNull();
		await expect(
			repository.getCredential('member-1', 'other-workspace-credential')
		).resolves.toBeNull();
		await expect(
			repository.updateHost('member-1', 'workspace-host', { name: 'Renamed shared host' })
		).resolves.toMatchObject({
			id: 'workspace-host',
			userId: 'owner-1',
			name: 'Renamed shared host'
		});
		await expect(
			repository.updateCredential('member-1', 'workspace-credential', {
				name: 'Renamed shared credential'
			})
		).resolves.toMatchObject({
			id: 'workspace-credential',
			userId: 'owner-1',
			name: 'Renamed shared credential'
		});
	});

	it('maps connection history details after filtering and orders newest sessions first', async () => {
		expect.assertions(5);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createWorkspace(workspace({ id: 'workspace-1', name: 'Operations' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'membership-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createHost(
			host({
				id: 'workspace-host',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				name: 'Shared shell',
				hostname: 'shared.example.test',
				username: 'deploy'
			})
		);
		await repository.createConnectionSession(
			session({
				id: 'private-session',
				userId: 'owner-1',
				workspaceId: null,
				startedAt: new Date('2026-05-15T09:59:00.000Z')
			})
		);
		await repository.createConnectionSession(
			session({
				id: 'failed-workspace-session',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				hostId: 'workspace-host',
				status: 'failed',
				startedAt: new Date('2026-05-15T10:00:00.000Z'),
				endedAt: new Date('2026-05-15T10:00:03.000Z'),
				errorCode: 'auth_failed',
				errorMessage: 'Credential rejected',
				errorDetails: { attempts: 2 }
			})
		);
		await repository.createConnectionSession(
			session({
				id: 'newer-workspace-session',
				userId: 'member-1',
				workspaceId: 'workspace-1',
				hostId: null,
				protocol: 'rdp',
				status: 'ended',
				startedAt: new Date('2026-05-15T10:02:00.000Z'),
				endedAt: new Date('2026-05-15T10:02:10.000Z')
			})
		);

		await expect(repository.listConnectionHistory('member-1')).resolves.toEqual([
			expect.objectContaining({ id: 'newer-workspace-session' }),
			expect.objectContaining({ id: 'failed-workspace-session' })
		]);
		await expect(
			repository.listConnectionHistory('member-1', {
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				hostId: 'workspace-host',
				status: 'failed',
				startedAfter: new Date('2026-05-15T09:59:59.000Z'),
				startedBefore: new Date('2026-05-15T10:00:00.000Z')
			})
		).resolves.toEqual([
			expect.objectContaining({
				id: 'failed-workspace-session',
				workspaceName: 'Operations',
				hostName: 'Shared shell',
				hostname: 'shared.example.test',
				hostUsername: 'deploy',
				durationMs: 3000,
				errorReason: 'Credential rejected',
				errorDetails: { attempts: 2 }
			})
		]);
		await expect(
			repository.listConnectionHistory('member-1', { workspaceId: null })
		).resolves.toEqual([]);
		await expect(
			repository.listConnectionHistory('member-1', { protocol: 'ssh', status: 'ended' })
		).resolves.toEqual([]);
		await expect(repository.listConnectionHistory('outsider-1')).resolves.toEqual([]);
	});

	it('persists connection session updates and keeps miss paths null', async () => {
		expect.assertions(6);

		const repository = new InMemoryTermixServicesRepository();
		const endedAt = new Date('2026-05-15T10:03:00.000Z');
		const updatedAt = new Date('2026-05-15T10:03:01.000Z');
		await repository.createConnectionSession(
			session({
				id: 'session-1',
				userId: 'user-1',
				hostId: 'host-1',
				status: 'active'
			})
		);

		await expect(repository.getConnectionSession('session-1')).resolves.toMatchObject({
			id: 'session-1',
			status: 'active'
		});
		await expect(
			repository.updateConnectionSession(
				'missing-session',
				connectionSessionPatch({ status: 'ended' })
			)
		).resolves.toBeNull();
		await expect(
			repository.updateConnectionSession(
				'session-1',
				connectionSessionPatch({
					status: 'failed',
					endedAt,
					errorCode: 'proxy_closed',
					errorMessage: 'Proxy closed before attach',
					errorDetails: { exitCode: 255 },
					updatedAt
				})
			)
		).resolves.toMatchObject({
			id: 'session-1',
			status: 'failed',
			endedAt,
			errorCode: 'proxy_closed',
			errorMessage: 'Proxy closed before attach',
			errorDetails: { exitCode: 255 },
			updatedAt
		});
		await expect(repository.getConnectionSession('session-1')).resolves.toMatchObject({
			status: 'failed',
			endedAt,
			updatedAt
		});
		await expect(repository.getConnectionSession('missing-session')).resolves.toBeNull();
		await expect(
			repository.listConnectionHistory('user-1', { status: 'failed', hostId: 'host-1' })
		).resolves.toEqual([
			expect.objectContaining({
				id: 'session-1',
				durationMs: 180000,
				errorReason: 'Proxy closed before attach'
			})
		]);
	});

	it('stores SSH tunnel and live session records with scoped update misses', async () => {
		expect.assertions(11);

		const repository = new InMemoryTermixServicesRepository();
		const updatedAt = new Date('2026-05-15T10:04:00.000Z');
		await repository.createWorkspace(workspace({ id: 'workspace-1' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'member-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createSshTunnelProfile(
			sshTunnelProfile({
				id: 'private-profile',
				userId: 'owner-1',
				workspaceId: null,
				sshHostId: 'private-host'
			})
		);
		await repository.createSshTunnelProfile(
			sshTunnelProfile({
				id: 'shared-profile',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				sshHostId: 'shared-host',
				targetHost: 'postgres.internal',
				targetPort: 5432
			})
		);
		await repository.createSshTunnelSession(
			sshTunnelSession({
				id: 'shared-tunnel-session',
				profileId: 'shared-profile',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				sshHostId: 'shared-host',
				status: 'starting'
			})
		);
		await repository.createSshLiveSession(
			sshLiveSession({
				id: 'live-session-1',
				userId: 'owner-1',
				hostId: 'shared-host',
				status: 'starting'
			})
		);
		await repository.createSshAttachTicket(
			sshAttachTicket({
				id: 'attach-ticket-1',
				userId: 'owner-1',
				sshLiveSessionId: 'live-session-1',
				ticketHash: 'attach-ticket-hash-1'
			})
		);

		await expect(repository.getSshTunnelProfile('member-1', 'private-profile')).resolves.toBeNull();
		await expect(
			repository.updateSshTunnelProfile('member-1', 'missing-profile', {
				name: 'Missing'
			})
		).resolves.toBeNull();
		await expect(
			repository.updateSshTunnelProfile('member-1', 'shared-profile', {
				name: 'Shared database tunnel',
				description: 'Operator approved database tunnel',
				updatedAt
			})
		).resolves.toMatchObject({
			id: 'shared-profile',
			userId: 'owner-1',
			name: 'Shared database tunnel',
			description: 'Operator approved database tunnel',
			updatedAt
		});
		await expect(
			repository.updateSshTunnelSession('outsider-1', 'shared-tunnel-session', {
				status: 'active'
			})
		).resolves.toBeNull();
		await expect(
			repository.updateSshTunnelSession('member-1', 'shared-tunnel-session', {
				status: 'active',
				lastSeenAt: updatedAt
			})
		).resolves.toMatchObject({
			id: 'shared-tunnel-session',
			userId: 'owner-1',
			status: 'active',
			lastSeenAt: updatedAt
		});
		await expect(
			repository.listSshTunnelSessions('member-1', {
				status: 'active',
				profileId: 'shared-profile'
			})
		).resolves.toEqual([expect.objectContaining({ id: 'shared-tunnel-session' })]);
		await expect(
			repository.updateSshLiveSession('member-1', 'live-session-1', {})
		).resolves.toBeNull();
		await expect(
			repository.updateSshLiveSession('owner-1', 'live-session-1', {
				status: 'attached',
				lastAttachedAt: updatedAt,
				terminalCols: 132,
				terminalRows: 43,
				updatedAt
			})
		).resolves.toMatchObject({
			id: 'live-session-1',
			status: 'attached',
			lastAttachedAt: updatedAt,
			terminalCols: 132,
			terminalRows: 43
		});
		await expect(
			repository.findReusableSshLiveSession('owner-1', 'shared-host')
		).resolves.toMatchObject({ id: 'live-session-1', status: 'attached' });
		await expect(
			repository.consumeSshAttachTicket('attach-ticket-hash-1', updatedAt)
		).resolves.toMatchObject({ id: 'attach-ticket-1', consumedAt: updatedAt });
		await expect(
			repository.consumeSshAttachTicket('attach-ticket-hash-1', updatedAt)
		).resolves.toBeNull();
	});

	it('returns false or null for deletion and update misses without disturbing existing rows', async () => {
		expect.assertions(10);

		const repository = new InMemoryTermixServicesRepository();
		await repository.createWorkspace(workspace({ id: 'workspace-1' }));
		await repository.createWorkspaceMembership(
			membership({ id: 'membership-1', workspaceId: 'workspace-1', userId: 'member-1' })
		);
		await repository.createHost(
			host({ id: 'host-1', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createCredential(
			credential({ id: 'credential-1', userId: 'owner-1', workspaceId: 'workspace-1' })
		);
		await repository.createTicket(ticket({ id: 'ticket-1', hostId: 'host-1' }));

		await expect(
			repository.updateWorkspace('missing-workspace', { name: 'Missing' })
		).resolves.toBeNull();
		await expect(
			repository.updateWorkspaceMembership('workspace-1', 'missing-user', { role: 'owner' })
		).resolves.toBeNull();
		await expect(repository.deleteWorkspaceMembership('workspace-1', 'missing-user')).resolves.toBe(
			false
		);
		await expect(
			repository.updateHost('outsider-1', 'host-1', { name: 'Nope' })
		).resolves.toBeNull();
		await expect(repository.deleteHost('outsider-1', 'host-1')).resolves.toBe(false);
		await expect(
			repository.updateCredential('outsider-1', 'credential-1', { name: 'Nope' })
		).resolves.toBeNull();
		await expect(repository.deleteCredential('outsider-1', 'credential-1')).resolves.toBe(false);
		await expect(
			repository.consumeTicket('missing-ticket-hash', new Date('2026-05-15T10:05:00.000Z'))
		).resolves.toBeNull();
		await expect(repository.getHost('member-1', 'host-1')).resolves.toMatchObject({
			id: 'host-1',
			name: 'Shell'
		});
		await expect(repository.getTicketByHash('ticket-hash-1')).resolves.toMatchObject({
			id: 'ticket-1',
			hostId: 'host-1'
		});
	});
});

describe('In-memory V5/V6 repository resources', () => {
	it('stores terminal recordings with owner-scoped updates and filters', async () => {
		expect.assertions(5);

		const repository = new InMemoryV5ResourcesRepository();
		const endedAt = new Date('2026-05-15T10:06:00.000Z');
		const retentionExpiresAt = new Date('2026-06-15T10:06:00.000Z');
		await repository.createTerminalRecording(
			terminalRecording({
				id: 'recording-1',
				userId: 'user-1',
				hostId: 'host-1',
				connectionSessionId: 'connection-session-1',
				status: 'recording'
			})
		);
		await repository.createTerminalRecording(
			terminalRecording({
				id: 'recording-2',
				userId: 'user-2',
				hostId: 'host-1',
				status: 'completed'
			})
		);

		await expect(
			repository.updateTerminalRecording('user-2', 'recording-1', { status: 'failed' })
		).resolves.toBeNull();
		await expect(
			repository.updateTerminalRecording('user-1', 'recording-1', {
				status: 'completed',
				endedAt,
				retentionExpiresAt,
				metadata: { bytes: 8192 },
				updatedAt: endedAt
			})
		).resolves.toMatchObject({
			id: 'recording-1',
			status: 'completed',
			endedAt,
			retentionExpiresAt,
			metadata: { bytes: 8192 }
		});
		await expect(
			repository.listTerminalRecordings('user-1', { hostId: 'host-1' })
		).resolves.toEqual([expect.objectContaining({ id: 'recording-1' })]);
		await expect(
			repository.listTerminalRecordings('user-1', { status: 'recording' })
		).resolves.toEqual([]);
		await expect(
			repository.listTerminalRecordings('user-2', { status: 'completed' })
		).resolves.toEqual([expect.objectContaining({ id: 'recording-2' })]);
	});

	it('stores V6 automation, job reports, job events, policies, reasons, and host intelligence', async () => {
		expect.assertions(21);

		const repository = new InMemoryV6ResourcesRepository();
		const now = new Date('2026-05-15T10:00:00.000Z');
		await repository.createAutomationTemplate(
			automationTemplate({
				id: 'template-private',
				userId: 'user-1',
				workspaceId: null,
				visibility: 'private'
			})
		);
		await repository.createAutomationTemplate(
			automationTemplate({
				id: 'template-workspace',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				visibility: 'workspace',
				requiresApproval: true
			})
		);
		await repository.createBackgroundJobWithTargets(
			backgroundJob({
				id: 'job-1',
				userId: 'owner-1',
				workspaceId: 'workspace-1',
				templateId: 'template-workspace',
				reason: 'Patch approved CVE window'
			}),
			[
				jobTarget({ id: 'target-1', jobId: 'job-1', hostId: 'host-1' }),
				jobTarget({ id: 'target-2', jobId: 'job-1', hostId: 'host-2', status: 'queued' })
			]
		);

		await expect(repository.listAutomationTemplates('user-1')).resolves.toEqual([
			expect.objectContaining({ id: 'template-private' })
		]);
		await expect(repository.listAutomationTemplates('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: 'template-workspace', requiresApproval: true })
		]);
		await expect(repository.getAutomationTemplate('missing-template')).resolves.toBeNull();
		await expect(repository.listBackgroundJobs('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: 'job-1', reason: 'Patch approved CVE window' })
		]);
		await expect(
			repository.updateBackgroundJob('job-1', {
				status: 'running',
				startedAt: now,
				updatedAt: now
			})
		).resolves.toMatchObject({ id: 'job-1', status: 'running', startedAt: now });
		await expect(
			repository.updateBackgroundJob('missing-job', { status: 'failed' })
		).resolves.toBeNull();
		await expect(repository.listJobTargets('job-1')).resolves.toEqual([
			expect.objectContaining({ id: 'target-1' }),
			expect.objectContaining({ id: 'target-2' })
		]);
		await expect(
			repository.updateJobTarget('target-1', {
				status: 'succeeded',
				output: { stdout: 'ok' },
				updatedAt: now
			})
		).resolves.toMatchObject({ id: 'target-1', status: 'succeeded', output: { stdout: 'ok' } });
		await expect(
			repository.updateJobTarget('missing-target', { status: 'failed' })
		).resolves.toBeNull();
		await expect(
			repository.recordJobEvent(jobEvent({ id: 'event-1', jobId: 'job-1' }))
		).resolves.toMatchObject({
			id: 'event-1',
			code: 'job.started'
		});
		await expect(
			repository.createJobReport(jobReport({ id: 'report-1', jobId: 'job-1' }))
		).resolves.toMatchObject({
			id: 'report-1',
			format: 'json',
			storageKey: 'reports/job-1.json'
		});
		await expect(
			repository.upsertWorkspacePolicy(workspacePolicy({ workspaceId: 'workspace-1' }))
		).resolves.toMatchObject({
			workspaceId: 'workspace-1',
			capability: 'bulk_job',
			effect: 'approval_required',
			requireReason: true
		});
		await expect(repository.getWorkspacePolicy('workspace-1', 'bulk_job')).resolves.toMatchObject({
			effect: 'approval_required'
		});
		await expect(
			repository.createApprovalRequest(approvalRequest({ id: 'approval-1' }))
		).resolves.toMatchObject({
			id: 'approval-1',
			status: 'pending',
			reason: 'Patch approved CVE window'
		});
		await expect(
			repository.updateApprovalRequest('approval-1', {
				status: 'approved',
				decidedBy: 'owner-1',
				decisionReason: 'Reviewed target list',
				decidedAt: now,
				updatedAt: now
			})
		).resolves.toMatchObject({
			id: 'approval-1',
			status: 'approved',
			decisionReason: 'Reviewed target list'
		});
		await expect(
			repository.updateApprovalRequest('missing-approval', { status: 'rejected' })
		).resolves.toBeNull();
		await expect(
			repository.recordOperationReason(operationReason({ id: 'reason-1' }))
		).resolves.toMatchObject({
			id: 'reason-1',
			reason: 'Patch approved CVE window'
		});
		await expect(
			repository.upsertHostFacts(hostFacts({ hostId: 'host-1' }))
		).resolves.toMatchObject({
			hostId: 'host-1',
			osName: 'NixOS',
			serviceHints: [{ name: 'sshd', state: 'running' }]
		});
		await expect(
			repository.upsertHostHealth(hostHealth({ hostId: 'host-1' }))
		).resolves.toMatchObject({
			hostId: 'host-1',
			state: 'healthy',
			consecutiveFailures: 0
		});
		await expect(repository.listHostFacts(['host-1', 'missing-host'])).resolves.toEqual([
			expect.objectContaining({ hostId: 'host-1' })
		]);
		await expect(repository.listHostHealth(['host-1', 'missing-host'])).resolves.toEqual([
			expect.objectContaining({ hostId: 'host-1' })
		]);
	});
});
