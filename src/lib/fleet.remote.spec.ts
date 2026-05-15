import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { hostService } from '$lib/server/services/hosts';
import { v6ResourcesService } from '$lib/server/services/v6-resources';
import { workspaceService } from '$lib/server/services/workspaces';
import {
	createFleetAutomationTemplate,
	decideFleetApproval,
	getFleetOverview,
	queueFleetBulkOperation
} from './fleet.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: { user: { id: 'user-1', username: 'ada' } } as {
			user?: { id: string; username: string };
		},
		url: new URL('https://termix.test/fleet')
	},
	refresh: vi.fn()
}));

vi.mock('$app/server', () => {
	function remoteCallable(type: 'command' | 'query', fn: (input?: unknown) => unknown) {
		const wrapper = vi.fn((input?: unknown) => {
			const promise = Promise.resolve(fn(input)) as Promise<unknown> & { refresh: () => void };
			promise.refresh = appServer.refresh;
			return promise;
		});
		Object.defineProperty(wrapper, '__', { value: { type } });
		return wrapper;
	}

	return {
		getRequestEvent: () => appServer.event,
		query: (fn: () => unknown) => remoteCallable('query', fn),
		command: (_validation: unknown, fn: (input?: unknown) => unknown) =>
			remoteCallable('command', fn)
	};
});

vi.mock('$lib/server/services/hosts', () => ({
	hostService: {
		list: vi.fn()
	}
}));

vi.mock('$lib/server/services/v6-resources', () => ({
	v6ResourcesService: {
		listAutomationTemplates: vi.fn(),
		listBackgroundJobs: vi.fn(),
		listApprovalRequests: vi.fn(),
		listHostFacts: vi.fn(),
		listHostHealth: vi.fn(),
		createAutomationTemplate: vi.fn(),
		createBackgroundJob: vi.fn(),
		evaluateWorkspacePolicy: vi.fn(),
		requestApproval: vi.fn(),
		recordOperationReason: vi.fn(),
		decideApproval: vi.fn()
	}
}));

vi.mock('$lib/server/services/workspaces', () => ({
	workspaceService: {
		list: vi.fn(),
		assertMember: vi.fn()
	}
}));

describe('fleet remote functions', () => {
	const now = new Date('2026-05-14T10:00:00.000Z');
	const later = new Date('2026-05-14T10:01:05.000Z');

	function host(overrides: Record<string, unknown> = {}) {
		return {
			id: 'host-1',
			name: 'API',
			protocol: 'ssh',
			hostname: 'api.internal',
			username: 'deploy',
			tags: ['production', 'region:eu'],
			folder: null,
			metadata: {},
			workspaceId: null,
			...overrides
		};
	}

	function workspace(overrides: Record<string, unknown> = {}) {
		return {
			id: 'workspace-1',
			name: 'Platform',
			ownerId: 'user-1',
			description: null,
			settings: {},
			createdAt: now,
			updatedAt: now,
			...overrides
		};
	}

	function templateRecord(overrides: Record<string, unknown> = {}) {
		return {
			id: 'template-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Restart service',
			kind: 'ssh_command',
			visibility: 'private',
			version: 1,
			description: 'restart',
			definition: { body: 'systemctl restart termix' },
			variables: [],
			isDangerous: false,
			requiresApproval: false,
			lastUsedAt: null,
			usageCount: 0,
			updatedBy: null,
			metadata: {},
			createdAt: now,
			updatedAt: now,
			...overrides
		};
	}

	function job(overrides: Record<string, unknown> = {}) {
		return {
			id: 'job-1',
			userId: 'user-1',
			workspaceId: null,
			templateId: null,
			templateVersion: 1,
			kind: 'bulk_ssh_command',
			status: 'queued',
			title: 'Bulk SSH command',
			request: {},
			targetCount: 2,
			completedCount: 0,
			failedCount: 0,
			concurrencyLimit: 2,
			reason: 'reviewed',
			report: {},
			cancellationRequestedAt: null,
			startedAt: null,
			finishedAt: null,
			createdAt: now,
			updatedAt: now,
			...overrides
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: { user: { id: 'user-1', username: 'ada' } },
			url: new URL('https://termix.test/fleet')
		};
		vi.mocked(hostService.list).mockResolvedValue([]);
		vi.mocked(workspaceService.list).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.listAutomationTemplates).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.listBackgroundJobs).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.listApprovalRequests).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.listHostFacts).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.listHostHealth).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.evaluateWorkspacePolicy).mockResolvedValue({
			allowed: true,
			approvalRequired: false
		} as never);
		vi.mocked(workspaceService.assertMember).mockResolvedValue({
			userId: 'user-1',
			workspaceId: 'workspace-1',
			role: 'operator'
		} as never);
	});

	it('builds fleet overview from user-visible service resources', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([host()] as never);
		vi.mocked(v6ResourcesService.listHostHealth).mockResolvedValueOnce([
			{ hostId: 'host-1', state: 'healthy', checkedAt: now }
		] as never);
		vi.mocked(v6ResourcesService.listHostFacts).mockResolvedValueOnce([
			{ hostId: 'host-1', osName: 'NixOS', memory: { usedPercent: 42 } }
		] as never);

		const overview = await getFleetOverview();

		expect(overview.hosts).toEqual([
			expect.objectContaining({
				id: 'host-1',
				status: 'healthy',
				region: 'eu',
				os: 'NixOS'
			})
		]);
		expect(v6ResourcesService.listHostFacts).toHaveBeenCalledWith(['host-1']);
		expect(v6ResourcesService.listAutomationTemplates).toHaveBeenCalledWith('user-1', []);
	});

	it('shapes workspace hosts, health states, facts, jobs, and approvals in the overview', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			host({
				id: 'host-1',
				name: 'RDP',
				protocol: 'rdp',
				username: null,
				tags: ['staging', 'critical'],
				folder: '/fra/support',
				metadata: { osName: 'Windows fallback', cpuLoad: 18, memoryLoad: 33 },
				workspaceId: 'workspace-1'
			}),
			host({
				id: 'host-2',
				name: 'Edge',
				protocol: 'ssh',
				tags: [],
				folder: '/edge',
				metadata: {},
				workspaceId: null
			})
		] as never);
		vi.mocked(workspaceService.list).mockResolvedValueOnce([workspace()] as never);
		vi.mocked(v6ResourcesService.listAutomationTemplates).mockResolvedValueOnce([
			templateRecord({
				id: 'template-high',
				name: 'Dangerous',
				isDangerous: true,
				requiresApproval: true,
				lastUsedAt: later,
				variables: [{ name: 'service', kind: 'string', required: true }]
			})
		] as never);
		vi.mocked(v6ResourcesService.listBackgroundJobs).mockResolvedValueOnce([
			job({
				id: 'job-running',
				status: 'cancelling',
				startedAt: now,
				createdAt: now
			}),
			job({
				id: 'job-blocked',
				status: 'cancelled',
				startedAt: now,
				finishedAt: later,
				createdAt: now
			}),
			job({
				id: 'job-failed',
				status: 'failed',
				startedAt: now,
				finishedAt: later,
				createdAt: now
			})
		] as never);
		vi.mocked(v6ResourcesService.listApprovalRequests).mockResolvedValueOnce([
			{
				id: 'approval-1',
				userId: 'user-1',
				workspaceId: 'workspace-1',
				capability: 'bulk_job',
				status: 'expired',
				reason: null,
				requestedBy: 'operator',
				decidedBy: null,
				expiresAt: later,
				createdAt: now,
				updatedAt: now
			}
		] as never);
		vi.mocked(v6ResourcesService.listHostFacts).mockResolvedValueOnce([
			{ hostId: 'host-1', osName: 'Windows Server 2025', memory: { usedPercent: 71 } }
		] as never);
		vi.mocked(v6ResourcesService.listHostHealth).mockResolvedValueOnce([
			{ hostId: 'host-1', state: 'auth_failed', checkedAt: now },
			{ hostId: 'host-2', state: 'unknown', checkedAt: null }
		] as never);

		const overview = await getFleetOverview();

		expect(v6ResourcesService.listAutomationTemplates).toHaveBeenCalledWith('user-1', [
			'workspace-1'
		]);
		expect(v6ResourcesService.listHostFacts).toHaveBeenCalledWith(['host-1', 'host-2']);
		expect(overview.hosts).toEqual([
			expect.objectContaining({
				id: 'host-1',
				workspace: 'Platform',
				owner: 'Unassigned',
				environment: 'staging',
				region: 'fra',
				os: 'Windows Server 2025',
				status: 'offline',
				memoryLoad: 71,
				riskScore: 80,
				patchState: 'overdue',
				protocols: ['rdp']
			}),
			expect.objectContaining({
				id: 'host-2',
				workspace: 'Personal',
				status: 'maintenance',
				protocols: ['ssh', 'sftp']
			})
		]);
		expect(overview.templates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'template-high',
					risk: 'high',
					approvalRequired: true,
					parameters: ['service'],
					lastRun: later.toISOString()
				})
			])
		);
		expect(overview.jobs).toEqual([
			expect.objectContaining({ id: 'job-running', status: 'running' }),
			expect.objectContaining({ id: 'job-blocked', status: 'blocked', duration: '65s' }),
			expect.objectContaining({
				id: 'job-failed',
				status: 'failed',
				reportUrl: '/fleet/reports/job-failed'
			})
		]);
		expect(overview.policies).toEqual([
			expect.objectContaining({
				id: 'approval-1',
				scope: 'Platform',
				status: 'rejected',
				approver: 'Pending',
				impact: 'No reason provided'
			})
		]);
	});

	it('rejects fleet overview access before service calls when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/fleet')
		};

		await expect(getFleetOverview()).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(hostService.list).not.toHaveBeenCalled();
	});

	it('rejects command access before service calls when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/fleet')
		};

		await expect(
			createFleetAutomationTemplate({ name: 'Restart service', kind: 'ssh_command' })
		).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		await expect(
			queueFleetBulkOperation({ operationId: 'bulk-ssh-command', targetHostIds: ['host-1'] })
		).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		await expect(
			decideFleetApproval({ approvalId: 'approval-1', status: 'approved' })
		).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(v6ResourcesService.createAutomationTemplate).not.toHaveBeenCalled();
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
		expect(v6ResourcesService.decideApproval).not.toHaveBeenCalled();
	});

	it('validates workspace template visibility when no workspace is available', async () => {
		await expect(
			createFleetAutomationTemplate({
				name: 'Restart service',
				kind: 'ssh_command',
				visibility: 'workspace'
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(v6ResourcesService.createAutomationTemplate).not.toHaveBeenCalled();
	});

	it('creates private automation templates through the V6 resource service', async () => {
		vi.mocked(v6ResourcesService.createAutomationTemplate).mockResolvedValueOnce(
			templateRecord() as never
		);

		const template = await createFleetAutomationTemplate({
			name: 'Restart service',
			kind: 'ssh_command',
			visibility: 'private',
			description: 'restart',
			body: 'systemctl restart termix'
		});

		expect(template).toMatchObject({
			id: 'template-1',
			name: 'Restart service',
			risk: 'low',
			approvalRequired: false
		});
		expect(v6ResourcesService.createAutomationTemplate).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				name: 'Restart service',
				kind: 'ssh_command',
				visibility: 'private',
				workspaceId: null,
				definition: { body: 'systemctl restart termix' }
			})
		);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('creates workspace templates with fallback workspace, normalized variables, and default body', async () => {
		vi.mocked(workspaceService.list).mockResolvedValueOnce([workspace()] as never);
		vi.mocked(v6ResourcesService.createAutomationTemplate).mockResolvedValueOnce(
			templateRecord({
				workspaceId: 'workspace-1',
				visibility: 'workspace',
				description: 'ssh command template',
				definition: { body: 'service: {{service}}' },
				variables: [{ name: 'service', kind: 'string', required: true }],
				isDangerous: true,
				requiresApproval: true
			}) as never
		);

		const created = await createFleetAutomationTemplate({
			name: '  Restart service  ',
			kind: 'ssh_command',
			visibility: 'workspace',
			variables: ' service, service,  ',
			dangerous: true
		});

		expect(created).toMatchObject({
			risk: 'high',
			approvalRequired: true,
			parameters: ['service']
		});
		expect(v6ResourcesService.createAutomationTemplate).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				name: 'Restart service',
				visibility: 'workspace',
				workspaceId: 'workspace-1',
				description: 'ssh command template',
				definition: { body: 'service: {{service}}' },
				variables: [{ name: 'service', kind: 'string', required: true }],
				isDangerous: true,
				metadata: { source: 'fleet-ui' }
			})
		);
	});

	it('validates template kind and name before create service calls', async () => {
		await expect(
			createFleetAutomationTemplate({ name: 'Deploy', kind: 'unsupported' })
		).rejects.toBeInstanceOf(ServiceValidationError);
		await expect(createFleetAutomationTemplate({ kind: 'ssh_command' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(v6ResourcesService.createAutomationTemplate).not.toHaveBeenCalled();
	});

	it('validates bulk operation inputs before queueing jobs', async () => {
		await expect(
			queueFleetBulkOperation({ operationId: 'unknown', targetHostIds: ['host-1'] })
		).rejects.toBeInstanceOf(ServiceValidationError);
		await expect(
			queueFleetBulkOperation({ operationId: 'bulk-ssh-command', targetHostIds: [' ', ''] })
		).rejects.toBeInstanceOf(ServiceValidationError);
		vi.mocked(hostService.list).mockResolvedValueOnce([host({ id: 'host-visible' })] as never);
		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-ssh-command',
				targetHostIds: ['host-visible', 'host-hidden']
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
	});

	it('queues bulk jobs with deduped targets, bounded concurrency, and recorded workspace reasons', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			host({ id: 'host-1', workspaceId: 'workspace-1' }),
			host({ id: 'host-2', workspaceId: 'workspace-1' })
		] as never);
		vi.mocked(workspaceService.assertMember).mockResolvedValueOnce({
			userId: 'user-1',
			workspaceId: 'workspace-1',
			role: 'auditor'
		} as never);
		vi.mocked(v6ResourcesService.createBackgroundJob).mockResolvedValueOnce({
			job: job({
				id: 'job-file',
				workspaceId: 'workspace-1',
				templateId: 'template-1',
				kind: 'bulk_file_transfer',
				title: 'Bulk file transfer',
				status: 'running',
				startedAt: now,
				targetCount: 2,
				completedCount: 1
			}),
			targets: []
		} as never);

		const queued = await queueFleetBulkOperation({
			operationId: 'bulk-file-transfer',
			templateId: ' template-1 ',
			targetHostIds: ['host-1', 'host-2', 'host-1'],
			reason: '  maintenance window  ',
			concurrencyLimit: 99
		});

		expect(workspaceService.assertMember).toHaveBeenCalledWith('user-1', 'workspace-1');
		expect(v6ResourcesService.evaluateWorkspacePolicy).toHaveBeenCalledWith({
			workspaceId: 'workspace-1',
			capability: 'bulk_job',
			role: 'auditor',
			targetCount: 2,
			reason: 'maintenance window'
		});
		expect(v6ResourcesService.recordOperationReason).toHaveBeenCalledWith('user-1', {
			workspaceId: 'workspace-1',
			capability: 'bulk_job',
			reason: 'maintenance window'
		});
		expect(v6ResourcesService.createBackgroundJob).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				workspaceId: 'workspace-1',
				templateId: 'template-1',
				kind: 'bulk_file_transfer',
				title: 'Bulk file transfer',
				targetHostIds: ['host-1', 'host-2'],
				concurrencyLimit: 10,
				reason: 'maintenance window',
				request: {
					operationId: 'bulk-file-transfer',
					templateId: 'template-1',
					reviewedHostIds: ['host-1', 'host-2'],
					secretPolicy: 'redacted'
				}
			})
		);
		expect(queued).toMatchObject({
			id: 'job-file',
			name: 'Bulk file transfer',
			status: 'running',
			targets: 2,
			successful: 1,
			reportUrl: '/fleet/reports/job-file'
		});
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('queues personal bulk jobs with default operation and lower concurrency bound', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([host({ workspaceId: null })] as never);
		vi.mocked(v6ResourcesService.createBackgroundJob).mockResolvedValueOnce({
			job: job({ concurrencyLimit: 1 }),
			targets: []
		} as never);

		await queueFleetBulkOperation({
			targetHostIds: ['host-1'],
			reason: ' operator reviewed ',
			concurrencyLimit: 0
		});

		expect(workspaceService.assertMember).not.toHaveBeenCalled();
		expect(v6ResourcesService.evaluateWorkspacePolicy).not.toHaveBeenCalled();
		expect(v6ResourcesService.recordOperationReason).toHaveBeenCalledWith('user-1', {
			workspaceId: null,
			capability: 'bulk_job',
			reason: 'operator reviewed'
		});
		expect(v6ResourcesService.createBackgroundJob).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				workspaceId: null,
				kind: 'bulk_ssh_command',
				title: 'Bulk SSH command',
				concurrencyLimit: 1,
				reason: 'operator reviewed'
			})
		);
	});

	it('uses the default reviewed reason when queueing without an operator reason', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([host({ workspaceId: null })] as never);
		vi.mocked(v6ResourcesService.createBackgroundJob).mockResolvedValueOnce({
			job: job({ reason: 'Reviewed from fleet operations' }),
			targets: []
		} as never);

		await queueFleetBulkOperation({
			operationId: 'bulk-ssh-command',
			targetHostIds: ['host-1']
		});

		expect(v6ResourcesService.recordOperationReason).not.toHaveBeenCalled();
		expect(v6ResourcesService.createBackgroundJob).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				reason: 'Reviewed from fleet operations'
			})
		);
	});

	it('requests approval and rejects queueing when workspace policy requires approval', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			host({ id: 'host-1', workspaceId: 'workspace-1' })
		] as never);
		vi.mocked(v6ResourcesService.evaluateWorkspacePolicy).mockResolvedValueOnce({
			allowed: false,
			approvalRequired: true
		} as never);

		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-file-transfer',
				targetHostIds: ['host-1']
			})
		).rejects.toBeInstanceOf(ServiceValidationError);

		expect(v6ResourcesService.requestApproval).toHaveBeenCalledWith('user-1', {
			workspaceId: 'workspace-1',
			capability: 'bulk_job',
			reason: 'bulk-file-transfer requires approval'
		});
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
	});

	it('rejects queueing when workspace policy blocks the bulk job', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			host({ id: 'host-1', workspaceId: 'workspace-1' })
		] as never);
		vi.mocked(v6ResourcesService.evaluateWorkspacePolicy).mockResolvedValueOnce({
			allowed: false,
			approvalRequired: false,
			blockedReason: 'viewer cannot run bulk jobs'
		} as never);

		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-ssh-command',
				targetHostIds: ['host-1'],
				reason: 'reviewed'
			})
		).rejects.toMatchObject({
			issues: ['viewer cannot run bulk jobs']
		});
		expect(v6ResourcesService.recordOperationReason).not.toHaveBeenCalled();
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
	});

	it('decides approvals with normalized status and reason', async () => {
		vi.mocked(v6ResourcesService.decideApproval).mockResolvedValueOnce(undefined as never);

		await expect(
			decideFleetApproval({
				approvalId: 'approval-1',
				status: 'approved',
				reason: 'reviewed'
			})
		).resolves.toBe(undefined);
		expect(v6ResourcesService.decideApproval).toHaveBeenCalledWith(
			'approval-1',
			'user-1',
			'approved',
			'reviewed'
		);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('validates approval decisions before service calls', async () => {
		await expect(
			decideFleetApproval({ approvalId: '', status: 'approved' })
		).rejects.toBeInstanceOf(ServiceValidationError);
		await expect(
			decideFleetApproval({ approvalId: 'approval-1', status: 'cancelled' })
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(v6ResourcesService.decideApproval).not.toHaveBeenCalled();
	});
});
