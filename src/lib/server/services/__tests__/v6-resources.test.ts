import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DrizzleV6ResourcesRepository,
	InMemoryV6ResourcesRepository,
	V6ResourcesService
} from '../v6-resources';
import {
	approvalRequest,
	automationTemplate,
	backgroundJob,
	hostFacts,
	hostHealth,
	jobEvent,
	jobReport,
	jobTarget,
	operationReason,
	QueuedDrizzleDatabase,
	workspacePolicy
} from './v6-resources-test-helpers';

afterEach(() => {
	vi.useRealTimers();
});

describe('V6ResourcesService', () => {
	it('creates validated private and workspace automation templates', async () => {
		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		const template = await service.createAutomationTemplate('user-1', {
			workspaceId: 'workspace-1',
			name: ' Restart service ',
			kind: 'ssh_command',
			visibility: 'workspace',
			description: 'Restart a named service',
			definition: { command: 'systemctl restart {{service}}' },
			variables: [
				{ name: 'service', kind: 'string', required: true },
				{ name: 'sudoPassword', kind: 'secret_ref' }
			],
			isDangerous: true,
			metadata: { source: 'test' }
		});

		expect(template).toMatchObject({
			userId: 'user-1',
			workspaceId: 'workspace-1',
			name: 'Restart service',
			kind: 'ssh_command',
			visibility: 'workspace',
			version: 1,
			requiresApproval: true,
			usageCount: 0
		});
		expect(template.variables).toEqual([
			{
				name: 'service',
				kind: 'string',
				required: true,
				defaultValue: undefined,
				options: undefined
			},
			{
				name: 'sudoPassword',
				kind: 'secret_ref',
				required: false,
				defaultValue: undefined,
				options: undefined
			}
		]);
		await expect(
			service.createAutomationTemplate('user-1', {
				name: 'Shared without workspace',
				kind: 'ssh_command',
				visibility: 'workspace'
			})
		).rejects.toMatchObject({
			issues: ['workspace visibility requires workspaceId']
		});
	});

	it('captures explicitly reviewed target hosts for background jobs', async () => {
		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		const result = await service.createBackgroundJob('operator-1', {
			workspaceId: 'workspace-1',
			templateId: 'template-1',
			templateVersion: 3,
			kind: 'bulk_ssh_command',
			title: 'Patch selected hosts',
			request: { commandPreview: 'dnf update -y' },
			targetHostIds: ['host-1', 'host-1', 'host-2'],
			concurrencyLimit: 2,
			reason: 'Monthly patch window'
		});

		expect(result.job).toMatchObject({
			userId: 'operator-1',
			workspaceId: 'workspace-1',
			templateId: 'template-1',
			templateVersion: 3,
			kind: 'bulk_ssh_command',
			status: 'pending',
			targetCount: 2,
			concurrencyLimit: 2,
			reason: 'Monthly patch window'
		});
		expect(result.targets.map((target) => target.hostId)).toEqual(['host-1', 'host-2']);

		const updated = await service.updateJobTarget(result.targets[0].id, {
			status: 'failed',
			attempt: 1,
			errorCode: 'auth_failed',
			errorMessage: 'Credential rejected',
			report: { redacted: true }
		});
		expect(updated).toMatchObject({
			status: 'failed',
			attempt: 1,
			errorCode: 'auth_failed',
			report: { redacted: true }
		});

		await expect(
			service.createBackgroundJob('operator-1', {
				kind: 'bulk_ssh_command',
				title: 'Hidden fanout',
				targetHostIds: []
			})
		).rejects.toMatchObject({
			issues: ['targetHostIds must include at least one visible host']
		});
	});

	it('rejects malformed V6 job target/report inputs without persisting partial records', async () => {
		expect.assertions(5);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);
		const result = await service.createBackgroundJob('operator-1', {
			kind: 'bulk_ssh_command',
			title: 'Patch selected hosts',
			targetHostIds: ['host-1'],
			concurrencyLimit: 1
		});

		await expect(
			service.updateJobTarget(result.targets[0].id, {
				status: 'running',
				attempt: -1
			})
		).rejects.toMatchObject({
			issues: ['attempt must be a non-negative integer']
		});
		await expect(
			service.updateJobTarget('missing-target', { status: 'succeeded' })
		).rejects.toMatchObject({
			message: 'Job target not found'
		});
		await expect(
			service.createJobReport({
				jobId: result.job.id,
				format: 'xml',
				storageKey: 'reports/job.xml'
			})
		).rejects.toMatchObject({
			issues: ['format must be json or csv']
		});
		await expect(
			service.decideApproval('missing-approval', 'owner-1', 'pending')
		).rejects.toMatchObject({
			issues: ['approval decision status must be approved, rejected, or cancelled']
		});
		await expect(repository.listJobTargets(result.job.id)).resolves.toEqual([
			expect.objectContaining({ id: result.targets[0].id, status: 'pending', attempt: 0 })
		]);
	});

	it('rejects malformed automation, job, policy, approval, and reason inputs before persistence', async () => {
		expect.assertions(9);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		await expect(
			service.createAutomationTemplate('user-1', {
				name: ' ',
				kind: 'shell_script' as never,
				visibility: 'public' as never,
				variables: 'service' as never
			})
		).rejects.toMatchObject({
			issues: [
				'variables must be an array',
				'name is required',
				'kind must be a supported automation template kind',
				'visibility must be private or workspace'
			]
		});
		await expect(
			service.createAutomationTemplate('user-1', {
				name: 'Duplicated variables',
				kind: 'ssh_command',
				variables: [
					{ name: 'service', kind: 'string', options: [' nginx ', '', 'postgres'] },
					{ name: ' service ', kind: 'password' as never }
				]
			})
		).rejects.toMatchObject({
			issues: ['variable service is duplicated', 'variable service kind is invalid']
		});
		await expect(
			service.createBackgroundJob('operator-1', {
				kind: 'bulk_ssh_command',
				title: 'Patch',
				templateVersion: 0,
				targetHostIds: ['host-1'],
				concurrencyLimit: 65
			})
		).rejects.toMatchObject({
			issues: [
				'concurrencyLimit must be an integer between 1 and 64',
				'templateVersion must be a positive integer'
			]
		});
		await expect(
			service.createBackgroundJob('operator-1', {
				kind: 'shell_script' as never,
				title: ' ',
				targetHostIds: ['host-1'],
				concurrencyLimit: 'many' as never
			})
		).rejects.toMatchObject({
			issues: [
				'kind must be a supported background job kind',
				'title is required',
				'concurrencyLimit must be an integer between 1 and 64'
			]
		});
		await expect(
			service.recordJobEvent({
				jobId: ' ',
				severity: 'trace',
				code: ' ',
				message: ''
			})
		).rejects.toMatchObject({
			issues: [
				'jobId is required',
				'severity must be debug, info, warning, or error',
				'code is required',
				'message is required'
			]
		});
		await expect(
			service.saveWorkspacePolicy({
				workspaceId: ' ',
				capability: 'screen_share' as never,
				effect: 'prompt' as never,
				minimumRole: 'admin' as never,
				maxTargets: 0
			})
		).rejects.toMatchObject({
			issues: [
				'workspaceId is required',
				'capability must be a supported workspace policy capability',
				'effect must be allow, deny, approval_required, or reason_required',
				'minimumRole must be viewer, member, operator, maintainer, or owner',
				'maxTargets must be an integer between 1 and 10000'
			]
		});
		await expect(
			service.requestApproval('operator-1', { capability: 'screen_share' as never })
		).rejects.toMatchObject({
			issues: ['capability must be a supported workspace policy capability']
		});
		await expect(
			service.recordOperationReason('operator-1', {
				capability: 'screen_share' as never,
				reason: ' '
			})
		).rejects.toMatchObject({
			issues: ['capability must be a supported workspace policy capability', 'reason is required']
		});
		expect({
			templates: repository.automationTemplates.size,
			jobs: repository.backgroundJobs.size,
			events: repository.jobEvents.size,
			policies: repository.workspacePolicies.size,
			approvals: repository.approvalRequests.size,
			reasons: repository.operationReasons.size
		}).toEqual({
			templates: 0,
			jobs: 0,
			events: 0,
			policies: 0,
			approvals: 0,
			reasons: 0
		});
	});

	it('redacts secret-looking job metadata before persistence', async () => {
		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		const result = await service.createBackgroundJob('operator-1', {
			kind: 'bulk_ssh_command',
			title: 'Secret safe job',
			request: {
				command: 'curl -H "Authorization: Bearer abc123" https://example.test',
				password: 'hunter2',
				nested: { apiKey: 'plain-key' },
				auditLines: ['token=abc123', { notes: 'password=hunter2' }]
			},
			targetHostIds: ['host-1'],
			metadata: {
				accessToken: 'job-token',
				annotations: ['Bearer abc123']
			}
		});
		await service.updateJobTarget(result.targets[0].id, {
			output: {
				stdout: 'token=abc123',
				privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----'
			},
			report: { password: 'hunter2', notes: 'apiKey=plain-key', status: 'failed' },
			metadata: { refreshToken: 'target-token', notes: ['secret=abc123'] }
		});
		await service.recordJobEvent({
			jobId: result.job.id,
			code: 'log',
			message: 'event token=abc123 password=hunter2',
			details: { token: 'abc123', line: 'password=hunter2' }
		});
		await service.createJobReport({
			jobId: result.job.id,
			format: 'json',
			storageKey: 'reports/job.json',
			summary: { secret: 'abc123', text: 'Bearer abc123' },
			metadata: { password: 'hunter2', text: 'token=abc123' }
		});

		const persistedJob = await repository.getBackgroundJob(result.job.id);
		const [persistedTarget] = await repository.listJobTargets(result.job.id);
		const persistedPayload = JSON.stringify({
			job: persistedJob,
			target: persistedTarget,
			events: [...repository.jobEvents.values()],
			reports: [...repository.jobReports.values()]
		});

		expect(persistedPayload).not.toContain('hunter2');
		expect(persistedPayload).not.toContain('plain-key');
		expect(persistedPayload).not.toContain('job-token');
		expect(persistedPayload).not.toContain('target-token');
		expect(persistedPayload).not.toContain('abc123');
		expect(persistedPayload).not.toContain('OPENSSH PRIVATE KEY');
		expect(persistedPayload).toContain('[REDACTED]');
	});

	it('redacts secret-looking event strings recursively while preserving operational context', async () => {
		expect.assertions(6);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		const event = await service.recordJobEvent({
			jobId: 'job-1',
			targetId: 'target-1',
			severity: 'warning',
			code: 'credential_probe',
			message:
				'probe failed Authorization: Bearer abc.def.ghi password=hunter2 -----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----',
			details: {
				host: 'shell-1',
				password: 'hunter2',
				nested: {
					token: 'abc.def.ghi',
					lines: ['safe line', 'apiKey=plain-key']
				}
			}
		});

		expect(event).toMatchObject({
			jobId: 'job-1',
			targetId: 'target-1',
			severity: 'warning',
			code: 'credential_probe'
		});
		expect(event.message).toContain('Bearer [REDACTED]');
		expect(event.message).toContain('[REDACTED PRIVATE KEY]');
		expect(JSON.stringify(event)).not.toContain('hunter2');
		expect(JSON.stringify(event)).not.toContain('plain-key');
		expect(event.details).toMatchObject({ host: 'shell-1' });
	});

	it('scopes list APIs to the requester plus explicitly visible workspaces', async () => {
		expect.assertions(5);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		const privateTemplate = await service.createAutomationTemplate('owner-1', {
			name: 'Private owner task',
			kind: 'operator_note',
			visibility: 'private'
		});
		const workspaceTemplate = await service.createAutomationTemplate('owner-1', {
			workspaceId: 'workspace-1',
			name: 'Shared workspace task',
			kind: 'ssh_command',
			visibility: 'workspace'
		});
		const otherPrivateTemplate = await service.createAutomationTemplate('other-1', {
			name: 'Other private task',
			kind: 'operator_note',
			visibility: 'private'
		});
		const workspaceApproval = await service.requestApproval('owner-1', {
			workspaceId: 'workspace-1',
			capability: 'bulk_job',
			reason: 'Patch hosts'
		});
		const otherPrivateApproval = await service.requestApproval('other-1', {
			capability: 'bulk_job',
			reason: 'Private operation'
		});

		await expect(service.listAutomationTemplates('owner-1')).resolves.toEqual([
			expect.objectContaining({ id: privateTemplate.id }),
			expect.objectContaining({ id: workspaceTemplate.id })
		]);
		await expect(service.listAutomationTemplates('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: workspaceTemplate.id })
		]);
		await expect(service.listAutomationTemplates('member-1', ['workspace-1'])).resolves.not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: otherPrivateTemplate.id })])
		);
		await expect(service.listApprovalRequests('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: workspaceApproval.id })
		]);
		expect([...repository.approvalRequests.values()].map((request) => request.id)).toContain(
			otherPrivateApproval.id
		);
	});

	it('normalizes stale host fact shapes while preserving only structured service hints', async () => {
		expect.assertions(5);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);
		const collectedAt = new Date('2026-05-14T12:00:00.000Z');

		const facts = await service.upsertHostFacts({
			hostId: ' host-1 ',
			workspaceId: ' workspace-1 ',
			collectedBy: ' operator-1 ',
			source: 'import',
			uptimeSeconds: '42' as unknown as number,
			cpu: ['stale'] as unknown as Record<string, unknown>,
			serviceHints: ['stale', { name: 'sshd', state: 'running' }, null] as unknown as Record<
				string,
				unknown
			>[],
			facts: null as unknown as Record<string, unknown>,
			collectedAt
		});

		expect(facts).toMatchObject({
			hostId: 'host-1',
			workspaceId: 'workspace-1',
			collectedBy: 'operator-1',
			source: 'import',
			uptimeSeconds: 42,
			cpu: {},
			facts: {},
			collectedAt
		});
		expect(facts.serviceHints).toEqual([{ name: 'sshd', state: 'running' }]);
		await expect(service.listHostFacts(['host-1', 'host-1', 'missing-host'])).resolves.toEqual([
			expect.objectContaining({ hostId: 'host-1' })
		]);
		await expect(service.listHostFacts([])).resolves.toEqual([]);
		await expect(
			service.upsertHostHealth({ hostId: 'host-1', state: 'ghost' as never })
		).rejects.toMatchObject({ issues: ['state must be a supported host health state'] });
	});

	it('evaluates workspace policies and records approvals and reasons', async () => {
		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		await service.saveWorkspacePolicy({
			workspaceId: 'workspace-1',
			capability: 'bulk_job',
			effect: 'approval_required',
			minimumRole: 'operator',
			maxTargets: 10,
			requireReason: true
		});

		await expect(
			service.evaluateWorkspacePolicy({
				workspaceId: 'workspace-1',
				capability: 'bulk_job',
				role: 'member',
				targetCount: 2,
				reason: 'Patch'
			})
		).resolves.toMatchObject({
			allowed: false,
			approvalRequired: false,
			blockedReason: 'requires operator role'
		});
		await expect(
			service.evaluateWorkspacePolicy({
				workspaceId: 'workspace-1',
				capability: 'bulk_job',
				role: 'operator',
				targetCount: 12,
				reason: 'Patch'
			})
		).resolves.toMatchObject({
			allowed: false,
			approvalRequired: false,
			blockedReason: 'target count exceeds 10'
		});
		await expect(
			service.evaluateWorkspacePolicy({
				workspaceId: 'workspace-1',
				capability: 'bulk_job',
				role: 'operator',
				targetCount: 2,
				reason: 'Patch'
			})
		).resolves.toMatchObject({
			allowed: false,
			approvalRequired: true,
			reasonRequired: true,
			blockedReason: 'approval is required'
		});

		const approval = await service.requestApproval('operator-1', {
			workspaceId: 'workspace-1',
			jobId: 'job-1',
			templateId: 'template-1',
			capability: 'bulk_job',
			reason: 'Patch selected hosts'
		});
		await expect(
			service.decideApproval(approval.id, 'owner-1', 'approved', 'Approved')
		).resolves.toMatchObject({
			status: 'approved',
			decidedBy: 'owner-1',
			decisionReason: 'Approved'
		});

		await expect(
			service.recordOperationReason('operator-1', {
				workspaceId: 'workspace-1',
				jobId: 'job-1',
				capability: 'bulk_job',
				reason: 'Patch selected hosts'
			})
		).resolves.toMatchObject({
			userId: 'operator-1',
			capability: 'bulk_job',
			reason: 'Patch selected hosts'
		});
	});

	it('covers reason-required and deny workspace policy branches deterministically', async () => {
		expect.assertions(4);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		await expect(
			service.evaluateWorkspacePolicy({
				workspaceId: 'workspace-1',
				capability: 'rdp_audio',
				role: 'viewer'
			})
		).resolves.toMatchObject({ allowed: true, policy: null });

		await service.saveWorkspacePolicy({
			workspaceId: 'workspace-1',
			capability: 'rdp_audio',
			effect: 'reason_required',
			minimumRole: 'viewer'
		});
		await expect(
			service.evaluateWorkspacePolicy({
				workspaceId: 'workspace-1',
				capability: 'rdp_audio',
				role: 'viewer'
			})
		).resolves.toMatchObject({
			allowed: false,
			reasonRequired: true,
			blockedReason: 'reason is required'
		});
		await expect(
			service.evaluateWorkspacePolicy({
				workspaceId: 'workspace-1',
				capability: 'rdp_audio',
				role: 'viewer',
				reason: 'Troubleshoot call audio'
			})
		).resolves.toMatchObject({
			allowed: true,
			reasonRequired: true
		});

		await service.saveWorkspacePolicy({
			workspaceId: 'workspace-1',
			capability: 'rdp_audio',
			effect: 'deny',
			minimumRole: 'viewer'
		});
		await expect(
			service.evaluateWorkspacePolicy({
				workspaceId: 'workspace-1',
				capability: 'rdp_audio',
				role: 'viewer',
				reason: 'Troubleshoot call audio'
			})
		).resolves.toMatchObject({
			allowed: false,
			blockedReason: 'rdp_audio is denied'
		});
	});

	it('upserts host facts and health for inventory checks', async () => {
		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		await expect(
			service.upsertHostFacts({
				hostId: 'host-1',
				workspaceId: 'workspace-1',
				collectedBy: 'operator-1',
				source: 'ssh',
				osName: 'NixOS',
				kernel: '6.12.1',
				uptimeSeconds: 3600,
				memory: { totalMiB: 32768 },
				serviceHints: [{ name: 'sshd', state: 'running' }]
			})
		).resolves.toMatchObject({
			hostId: 'host-1',
			osName: 'NixOS',
			uptimeSeconds: 3600,
			memory: { totalMiB: 32768 }
		});

		await service.upsertHostHealth({
			hostId: 'host-1',
			workspaceId: 'workspace-1',
			state: 'auth_failed',
			consecutiveFailures: 2,
			failureReason: 'Credential rejected'
		});
		await expect(repository.getHostHealth('host-1')).resolves.toMatchObject({
			state: 'auth_failed',
			consecutiveFailures: 2,
			failureReason: 'Credential rejected'
		});

		await expect(
			service.upsertHostFacts({
				hostId: 'host-2',
				source: 'ssh',
				uptimeSeconds: -1
			})
		).rejects.toMatchObject({
			issues: ['uptimeSeconds must be a non-negative integer']
		});
	});

	it('keeps job retention, aggregate counts, reports, and list visibility consistent', async () => {
		expect.assertions(8);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);
		const retentionExpiresAt = new Date('2026-05-22T10:00:00.000Z');
		const startedAt = new Date('2026-05-15T10:00:00.000Z');
		const finishedAt = new Date('2026-05-15T10:05:00.000Z');
		const reportExpiresAt = new Date('2026-06-15T10:05:00.000Z');

		const result = await service.createBackgroundJob('operator-1', {
			workspaceId: 'workspace-1',
			kind: 'bulk_ssh_command',
			title: 'Patch mixed fleet',
			targetHostIds: ['host-1', 'host-2', 'host-3'],
			concurrencyLimit: 2,
			retentionExpiresAt,
			metadata: { rollout: 'v7' }
		});
		await service.createBackgroundJob('other-1', {
			kind: 'inventory_check',
			title: 'Private inventory',
			targetHostIds: ['host-9']
		});
		await expect(
			repository.updateBackgroundJob(result.job.id, {
				status: 'completed_with_errors',
				completedCount: 1,
				failedCount: 1,
				skippedCount: 1,
				startedAt,
				finishedAt,
				updatedAt: finishedAt,
				metadata: { summary: 'partial' }
			})
		).resolves.toMatchObject({
			status: 'completed_with_errors',
			completedCount: 1,
			failedCount: 1,
			skippedCount: 1,
			retentionExpiresAt,
			metadata: { summary: 'partial' }
		});
		await expect(
			service.updateJobTarget(result.targets[0].id, {
				status: 'succeeded',
				attempt: 1,
				report: { changed: true },
				finishedAt
			})
		).resolves.toMatchObject({
			status: 'succeeded',
			attempt: 1,
			report: { changed: true }
		});
		await expect(
			service.createJobReport({
				jobId: result.job.id,
				format: 'csv',
				storageKey: 'reports/job-1.csv',
				summary: { completed: 1, failed: 1, skipped: 1 },
				generatedBy: 'operator-1',
				generatedAt: finishedAt,
				expiresAt: reportExpiresAt,
				metadata: { retained: true }
			})
		).resolves.toMatchObject({
			jobId: result.job.id,
			format: 'csv',
			storageKey: 'reports/job-1.csv',
			summary: { completed: 1, failed: 1, skipped: 1 },
			generatedBy: 'operator-1',
			generatedAt: finishedAt,
			expiresAt: reportExpiresAt,
			metadata: { retained: true }
		});
		await expect(service.listBackgroundJobs('operator-1')).resolves.toEqual([
			expect.objectContaining({ id: result.job.id })
		]);
		await expect(service.listBackgroundJobs('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: result.job.id })
		]);
		await expect(service.listBackgroundJobs('member-1', ['workspace-2'])).resolves.toEqual([]);
		expect([...repository.jobReports.values()]).toEqual([
			expect.objectContaining({
				jobId: result.job.id,
				format: 'csv',
				expiresAt: reportExpiresAt
			})
		]);
		await expect(repository.getBackgroundJob('missing-job')).resolves.toBeNull();
	});

	it('rejects additional malformed V6 resource inputs without repository writes', async () => {
		expect.assertions(6);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);
		const result = await service.createBackgroundJob('operator-1', {
			kind: 'bulk_ssh_command',
			title: 'Patch selected hosts',
			targetHostIds: ['host-1']
		});
		const countsBefore = {
			targets: repository.jobTargets.size,
			reports: repository.jobReports.size,
			facts: repository.hostFacts.size,
			health: repository.hostHealth.size
		};

		await expect(
			service.updateJobTarget(result.targets[0].id, {
				status: 'done' as never,
				errorCode: ' auth_failed ',
				errorMessage: ' Credential rejected '
			})
		).rejects.toMatchObject({
			issues: ['status must be a supported job target status']
		});
		await expect(
			service.createJobReport({
				jobId: ' ',
				format: 'pdf' as never,
				storageKey: ' '
			})
		).rejects.toMatchObject({
			issues: ['jobId is required', 'format must be json or csv', 'storageKey is required']
		});
		await expect(
			service.upsertHostFacts({
				hostId: ' ',
				source: 'probe' as never,
				uptimeSeconds: 1
			})
		).rejects.toMatchObject({
			issues: ['hostId is required', 'source must be ssh, manual, or import']
		});
		await expect(
			service.upsertHostHealth({
				hostId: ' ',
				state: 'healthy',
				consecutiveFailures: -1
			})
		).rejects.toMatchObject({
			issues: ['hostId is required', 'consecutiveFailures must be a non-negative integer']
		});
		expect({
			targets: repository.jobTargets.size,
			reports: repository.jobReports.size,
			facts: repository.hostFacts.size,
			health: repository.hostHealth.size
		}).toEqual(countsBefore);
		await expect(repository.listJobTargets(result.job.id)).resolves.toEqual([
			expect.objectContaining({
				id: result.targets[0].id,
				status: 'pending',
				errorCode: null as never,
				errorMessage: null as never
			})
		]);
	});

	it('normalizes template defaults and rejects malformed variable entries without writes', async () => {
		expect.assertions(4);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);

		const template = await service.createAutomationTemplate('author-1', {
			name: ' Collect version ',
			kind: 'operator_note',
			description: '  Keep an audit note  ',
			requiresApproval: true,
			variables: [
				{
					name: ' channel ',
					kind: 'enum',
					required: true,
					defaultValue: 'stable',
					options: [' stable ', '', 'canary']
				}
			],
			metadata: ['legacy'] as never
		});

		expect(template).toMatchObject({
			userId: 'author-1',
			workspaceId: null as never,
			name: 'Collect version',
			description: 'Keep an audit note',
			visibility: 'private',
			version: 1,
			isDangerous: false,
			requiresApproval: true,
			updatedBy: 'author-1',
			metadata: {}
		});
		expect(template.variables).toEqual([
			{
				name: 'channel',
				kind: 'enum',
				required: true,
				defaultValue: 'stable',
				options: ['stable', 'canary']
			}
		]);
		await expect(
			service.createAutomationTemplate('author-1', {
				name: 'Broken variables',
				kind: 'operator_note',
				variables: ['stale', { name: ' ', kind: 'string' }] as never
			})
		).rejects.toMatchObject({
			issues: ['variables must contain objects', 'variable name is required']
		});
		expect(repository.automationTemplates.size).toBe(1);
	});

	it('keeps approval decisions, reasons, and missing approval behavior explicit', async () => {
		expect.assertions(6);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);
		const expiresAt = new Date('2026-05-16T09:00:00.000Z');

		const privateApproval = await service.requestApproval('operator-1', {
			capability: 'ssh_tunnel',
			reason: ' Temporary diagnostic tunnel ',
			expiresAt,
			metadata: ['legacy'] as never
		});
		const workspaceApproval = await service.requestApproval('operator-2', {
			workspaceId: 'workspace-2',
			capability: 'host_facts'
		});

		expect(privateApproval).toMatchObject({
			workspaceId: null as never,
			status: 'pending',
			requestedBy: 'operator-1',
			reason: 'Temporary diagnostic tunnel',
			expiresAt,
			metadata: {}
		});
		await expect(
			service.decideApproval(privateApproval.id, 'owner-1', 'rejected')
		).resolves.toMatchObject({
			status: 'rejected',
			decidedBy: 'owner-1',
			decisionReason: null as never
		});
		await expect(
			service.decideApproval('missing-approval', 'owner-1', 'cancelled', 'No longer needed')
		).rejects.toMatchObject({
			message: 'Approval request not found'
		});
		await expect(service.listApprovalRequests('operator-1')).resolves.toEqual([
			expect.objectContaining({ id: privateApproval.id })
		]);
		await expect(service.listApprovalRequests('member-1', ['workspace-2'])).resolves.toEqual([
			expect.objectContaining({ id: workspaceApproval.id })
		]);
		await expect(
			service.recordOperationReason('operator-1', {
				workspaceId: ' workspace-2 ',
				hostId: ' host-1 ',
				jobId: ' job-1 ',
				templateId: ' template-1 ',
				capability: 'host_facts',
				reason: '  Refresh stale inventory  ',
				metadata: ['legacy'] as never
			})
		).resolves.toMatchObject({
			workspaceId: 'workspace-2',
			hostId: 'host-1',
			jobId: 'job-1',
			templateId: 'template-1',
			reason: 'Refresh stale inventory',
			metadata: {}
		});
	});

	it('generates reports with default dates and tolerates malformed summary metadata', async () => {
		expect.assertions(6);

		const fallbackNow = new Date('2026-05-20T10:30:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(fallbackNow);
		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);
		const result = await service.createBackgroundJob('operator-1', {
			kind: 'inventory_check',
			title: 'Refresh host facts',
			targetHostIds: ['host-1'],
			retentionExpiresAt: '2026-05-16' as never,
			request: ['legacy'] as never,
			metadata: null as never
		});

		expect(result.job).toMatchObject({
			request: {},
			retentionExpiresAt: null as never,
			metadata: {}
		});

		const report = await service.createJobReport({
			jobId: ` ${result.job.id} `,
			format: 'json',
			storageKey: ' reports/host-facts.json ',
			summary: ['legacy'] as never,
			generatedBy: ' operator-1 ',
			generatedAt: '2026-05-15' as never,
			expiresAt: '2026-06-15' as never,
			metadata: null as never
		});

		expect(report).toMatchObject({
			jobId: result.job.id,
			storageKey: 'reports/host-facts.json',
			summary: {},
			generatedBy: 'operator-1',
			expiresAt: null as never,
			metadata: {}
		});
		expect(report.generatedAt).toBeInstanceOf(Date);
		expect(report.generatedAt.getTime()).toBe(fallbackNow.getTime());
		expect(report.createdAt).toBeInstanceOf(Date);
		expect([...repository.jobReports.values()]).toEqual([
			expect.objectContaining({ id: report.id })
		]);
	});

	it('normalizes host health defaults, dates, metadata, and missing lookups', async () => {
		expect.assertions(7);

		const repository = new InMemoryV6ResourcesRepository();
		const service = new V6ResourcesService(repository);
		const checkedAt = new Date('2026-05-15T10:00:00.000Z');
		const nextCheckAt = new Date('2026-05-15T10:05:00.000Z');
		const lastSuccessfulConnectionAt = new Date('2026-05-15T09:55:00.000Z');

		const health = await service.upsertHostHealth({
			hostId: ' host-1 ',
			workspaceId: ' workspace-1 ',
			lastSuccessfulConnectionAt,
			consecutiveFailures: '2' as never,
			checkedAt,
			nextCheckAt,
			metadata: ['legacy'] as never
		});

		expect(health).toMatchObject({
			hostId: 'host-1',
			workspaceId: 'workspace-1',
			state: 'unknown',
			lastSuccessfulConnectionAt,
			lastFailedConnectionAt: null as never,
			consecutiveFailures: 2,
			failureReason: null as never,
			checkedAt,
			nextCheckAt,
			metadata: {}
		});
		await expect(service.listHostHealth(['host-1', 'host-1', 'missing-host'])).resolves.toEqual([
			expect.objectContaining({ hostId: 'host-1' })
		]);
		await expect(service.listHostHealth([])).resolves.toEqual([]);
		await expect(repository.getHostHealth('missing-host')).resolves.toBeNull();
		await expect(
			service.upsertHostHealth({
				hostId: 'host-1',
				state: 'healthy',
				consecutiveFailures: 1.5
			})
		).rejects.toMatchObject({
			issues: ['consecutiveFailures must be a non-negative integer']
		});
		await expect(repository.getHostHealth('host-1')).resolves.toMatchObject({
			state: 'unknown',
			consecutiveFailures: 2
		});
		expect(repository.hostHealth.size).toBe(1);
	});

	it('maps Drizzle repository fallback rows and database patch payloads', async () => {
		expect.assertions(25);

		const now = new Date('2026-05-15T10:00:00.000Z');
		const database = new QueuedDrizzleDatabase({
			selectRows: [
				[
					automationTemplate({
						id: 'template-visible',
						workspaceId: 'workspace-1',
						metadata: null as never,
						definition: null as never,
						variables: null as never
					})
				],
				[
					automationTemplate({
						id: 'template-get',
						metadata: null as never,
						definition: null as never,
						variables: null as never
					})
				],
				[
					backgroundJob({
						id: 'job-visible',
						workspaceId: 'workspace-1',
						request: null as never,
						metadata: null as never
					})
				],
				[backgroundJob({ id: 'job-get', request: null as never, metadata: null as never })],
				[
					jobTarget({
						id: 'target-visible',
						output: null as never,
						report: null as never,
						metadata: null as never
					})
				],
				[workspacePolicy({ settings: null as never })],
				[approvalRequest({ id: 'approval-visible', metadata: null as never })],
				[
					hostFacts({
						hostId: 'host-visible',
						cpu: null as never,
						memory: null as never,
						disk: null as never,
						serviceHints: null as never,
						facts: null as never
					})
				],
				[
					hostFacts({
						hostId: 'host-get',
						cpu: null as never,
						memory: null as never,
						disk: null as never,
						serviceHints: null as never,
						facts: null as never
					})
				],
				[hostHealth({ hostId: 'health-visible', metadata: null as never })],
				[hostHealth({ hostId: 'health-get', metadata: null as never })]
			],
			insertRows: [
				[automationTemplate({ id: 'template-created' })],
				[backgroundJob({ id: 'job-created' })],
				[jobTarget({ id: 'target-created', jobId: 'job-created' })],
				[jobEvent({ id: 'event-created', details: null as never })],
				[jobReport({ id: 'report-created', summary: null as never, metadata: null as never })],
				[workspacePolicy({ effect: 'deny', settings: null as never })],
				[approvalRequest({ id: 'approval-created', metadata: null as never })],
				[operationReason({ id: 'reason-created', metadata: null as never })],
				[
					hostFacts({
						hostId: 'host-upsert',
						cpu: null as never,
						memory: null as never,
						disk: null as never,
						serviceHints: null as never,
						facts: null as never
					})
				],
				[hostHealth({ hostId: 'health-upsert', metadata: null as never })]
			],
			updateRows: [
				[backgroundJob({ id: 'job-get', status: 'running', metadata: null as never })],
				[
					jobTarget({
						id: 'target-visible',
						status: 'failed',
						output: null as never,
						report: null as never,
						metadata: null as never
					})
				],
				[approvalRequest({ id: 'approval-visible', status: 'cancelled', metadata: null as never })]
			]
		});
		const repository = new DrizzleV6ResourcesRepository(database as never);

		await expect(repository.listAutomationTemplates('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({
				id: 'template-visible',
				definition: {},
				variables: [],
				metadata: {}
			})
		]);
		await expect(repository.getAutomationTemplate('template-get')).resolves.toMatchObject({
			id: 'template-get',
			definition: {},
			variables: [],
			metadata: {}
		});
		await expect(
			repository.createAutomationTemplate(automationTemplate({ id: 'template-created' }))
		).resolves.toMatchObject({ id: 'template-created' });
		await expect(repository.listBackgroundJobs('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: 'job-visible', request: {}, metadata: {} })
		]);
		await expect(repository.getBackgroundJob('job-get')).resolves.toMatchObject({
			id: 'job-get',
			request: {},
			metadata: {}
		});
		await expect(
			repository.createBackgroundJobWithTargets(backgroundJob({ id: 'job-created' }), [
				jobTarget({ id: 'target-created', jobId: 'job-created' })
			])
		).resolves.toMatchObject({
			job: { id: 'job-created' },
			targets: [expect.objectContaining({ id: 'target-created' })]
		});
		await expect(
			repository.updateBackgroundJob('job-get', {
				status: 'running',
				completedCount: 1,
				failedCount: 1,
				skippedCount: 0,
				startedAt: now,
				finishedAt: now,
				metadata: { summary: 'partial' },
				updatedAt: now
			})
		).resolves.toMatchObject({ id: 'job-get', status: 'running', metadata: {} });
		await expect(repository.listJobTargets('job-get')).resolves.toEqual([
			expect.objectContaining({ id: 'target-visible', output: {}, report: {}, metadata: {} })
		]);
		await expect(
			repository.updateJobTarget('target-visible', {
				status: 'failed',
				attempt: 2,
				startedAt: now,
				finishedAt: now,
				errorCode: 'auth_failed',
				errorMessage: 'Credential rejected',
				output: { stdout: 'failed' },
				report: { changed: false },
				metadata: { retry: false },
				updatedAt: now
			})
		).resolves.toMatchObject({
			id: 'target-visible',
			status: 'failed',
			output: {},
			report: {},
			metadata: {}
		});
		await expect(
			repository.recordJobEvent(jobEvent({ id: 'event-created' }))
		).resolves.toMatchObject({
			id: 'event-created',
			details: {}
		});
		await expect(
			repository.createJobReport(jobReport({ id: 'report-created' }))
		).resolves.toMatchObject({
			id: 'report-created',
			summary: {},
			metadata: {}
		});
		await expect(repository.getWorkspacePolicy('workspace-1', 'bulk_job')).resolves.toMatchObject({
			workspaceId: 'workspace-1',
			settings: {}
		});
		await expect(
			repository.upsertWorkspacePolicy(workspacePolicy({ effect: 'deny' }))
		).resolves.toMatchObject({ effect: 'deny', settings: {} });
		await expect(repository.listApprovalRequests('member-1', ['workspace-1'])).resolves.toEqual([
			expect.objectContaining({ id: 'approval-visible', metadata: {} })
		]);
		await expect(
			repository.createApprovalRequest(approvalRequest({ id: 'approval-created' }))
		).resolves.toMatchObject({ id: 'approval-created', metadata: {} });
		await expect(
			repository.updateApprovalRequest('approval-visible', {
				status: 'cancelled',
				decidedBy: 'owner-1',
				decisionReason: 'Expired',
				decidedAt: now,
				metadata: { source: 'retention-cleanup' },
				updatedAt: now
			})
		).resolves.toMatchObject({ id: 'approval-visible', status: 'cancelled', metadata: {} });
		await expect(
			repository.recordOperationReason(operationReason({ id: 'reason-created' }))
		).resolves.toMatchObject({ id: 'reason-created', metadata: {} });
		await expect(repository.listHostFacts(['host-visible'])).resolves.toEqual([
			expect.objectContaining({
				hostId: 'host-visible',
				cpu: {},
				memory: {},
				disk: {},
				serviceHints: [],
				facts: {}
			})
		]);
		await expect(repository.getHostFacts('host-get')).resolves.toMatchObject({
			hostId: 'host-get',
			cpu: {},
			memory: {},
			disk: {},
			serviceHints: [],
			facts: {}
		});
		await expect(
			repository.upsertHostFacts(hostFacts({ hostId: 'host-upsert' }))
		).resolves.toMatchObject({
			hostId: 'host-upsert',
			cpu: {},
			memory: {},
			disk: {},
			serviceHints: [],
			facts: {}
		});
		await expect(repository.listHostHealth(['health-visible'])).resolves.toEqual([
			expect.objectContaining({ hostId: 'health-visible', metadata: {} })
		]);
		await expect(repository.getHostHealth('health-get')).resolves.toMatchObject({
			hostId: 'health-get',
			metadata: {}
		});
		await expect(
			repository.upsertHostHealth(hostHealth({ hostId: 'health-upsert' }))
		).resolves.toMatchObject({ hostId: 'health-upsert', metadata: {} });
		expect(database.updatePatches).toEqual([
			expect.objectContaining({
				status: 'running',
				completedCount: 1,
				failedCount: 1,
				skippedCount: 0,
				cancellationRequestedAt: undefined,
				startedAt: now,
				finishedAt: now,
				metadata: { summary: 'partial' },
				updatedAt: now
			}),
			expect.objectContaining({
				status: 'failed',
				attempt: 2,
				errorCode: 'auth_failed',
				errorMessage: 'Credential rejected',
				output: { stdout: 'failed' },
				report: { changed: false },
				metadata: { retry: false },
				updatedAt: now
			}),
			expect.objectContaining({
				status: 'cancelled',
				decidedBy: 'owner-1',
				decisionReason: 'Expired',
				decidedAt: now,
				metadata: { source: 'retention-cleanup' },
				updatedAt: now
			})
		]);
		expect(database.conflictPatches).toEqual([
			expect.objectContaining({
				effect: 'deny',
				minimumRole: 'operator',
				maxTargets: 100,
				requireReason: true,
				settings: { window: 'maintenance' }
			}),
			expect.objectContaining({
				workspaceId: 'workspace-1',
				collectedBy: 'operator-1',
				source: 'ssh',
				osName: 'NixOS',
				serviceHints: [{ name: 'sshd', state: 'running' }]
			}),
			expect.objectContaining({
				workspaceId: 'workspace-1',
				state: 'healthy',
				consecutiveFailures: 0,
				metadata: { checkedBy: 'probe' }
			})
		]);
	});
});
