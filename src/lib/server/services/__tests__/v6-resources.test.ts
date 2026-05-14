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
