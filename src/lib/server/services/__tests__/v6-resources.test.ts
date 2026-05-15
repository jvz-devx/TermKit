import { describe, expect, it } from 'vitest';
import { InMemoryV6ResourcesRepository, V6ResourcesService } from '../v6-resources';

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
		expect.assertions(8);

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
});
