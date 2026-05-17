import { describe, expect, it } from 'vitest';
import { DrizzleV6ResourcesRepository } from '../v6-resources';
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

describe('DrizzleV6ResourcesRepository mapping and patches', () => {
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
