import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { hostService } from '$lib/server/services/hosts';
import { v6ResourcesService } from '$lib/server/services/v6-resources';
import { workspaceService } from '$lib/server/services/workspaces';
import {
	createFleetAutomationTemplate,
	getFleetOverview,
	getFleetRunbooks,
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
		listHostFacts: vi.fn(),
		listHostHealth: vi.fn(),
		createAutomationTemplate: vi.fn(),
		createBackgroundJob: vi.fn(),
		recordOperationReason: vi.fn()
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
		vi.mocked(workspaceService.assertMember).mockResolvedValue({
			userId: 'user-1',
			workspaceId: 'workspace-1',
			role: 'operator'
		} as never);
		vi.mocked(v6ResourcesService.listAutomationTemplates).mockResolvedValue([
			templateRecord()
		] as never);
		vi.mocked(v6ResourcesService.listBackgroundJobs).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.listHostFacts).mockResolvedValue([]);
		vi.mocked(v6ResourcesService.listHostHealth).mockResolvedValue([]);
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
		expect(overview).not.toHaveProperty('policies');
		expect(v6ResourcesService.listHostFacts).toHaveBeenCalledWith(['host-1']);
		expect(v6ResourcesService.listAutomationTemplates).toHaveBeenCalledWith('user-1', []);
	});

	it('shapes workspace hosts, health states, facts, jobs, and templates in the overview', async () => {
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
			job({ id: 'job-running', status: 'cancelling', startedAt: now, createdAt: now }),
			job({ id: 'job-blocked', status: 'cancelled', startedAt: now, finishedAt: later }),
			job({ id: 'job-failed', status: 'failed', startedAt: now, finishedAt: later })
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
				reportUrl: '/fleet/executions/job-failed'
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

	it('loads runbook page data without unrelated overview subqueries', async () => {
		vi.mocked(workspaceService.list).mockResolvedValueOnce([
			workspace({ id: 'workspace-z', name: 'Zeta' }),
			workspace({ id: 'workspace-a', name: 'Alpha' })
		] as never);
		vi.mocked(v6ResourcesService.listAutomationTemplates).mockResolvedValueOnce([
			templateRecord({ id: 'template-custom', name: 'Custom deploy' })
		] as never);

		const runbooks = await getFleetRunbooks();

		expect(runbooks.workspaces).toEqual([
			{ id: 'workspace-a', name: 'Alpha' },
			{ id: 'workspace-z', name: 'Zeta' }
		]);
		expect(runbooks.templates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'template-custom', name: 'Custom deploy' })
			])
		);
		expect(v6ResourcesService.listAutomationTemplates).toHaveBeenCalledWith('user-1', [
			'workspace-z',
			'workspace-a'
		]);
		expect(hostService.list).not.toHaveBeenCalled();
		expect(v6ResourcesService.listBackgroundJobs).not.toHaveBeenCalled();
		expect(v6ResourcesService.listHostFacts).not.toHaveBeenCalled();
		expect(v6ResourcesService.listHostHealth).not.toHaveBeenCalled();
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
		expect(v6ResourcesService.createAutomationTemplate).not.toHaveBeenCalled();
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
	});

	it('requires an explicit workspace id for workspace template visibility', async () => {
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
			risk: 'low'
		});
		expect(template).not.toHaveProperty('approvalRequired');
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
		expect(appServer.refresh).toHaveBeenCalledTimes(4);
	});

	it('creates workspace templates with an explicit workspace, normalized variables, and default body', async () => {
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
			workspaceId: 'workspace-1',
			variables: ' service, service,  ',
			dangerous: true
		});

		expect(workspaceService.assertMember).toHaveBeenCalledWith('user-1', 'workspace-1');
		expect(created).toMatchObject({
			risk: 'high',
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
			queueFleetBulkOperation({
				operationId: 'unknown',
				templateId: 'template-1',
				targetHostIds: ['host-1']
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-ssh-command',
				templateId: 'template-1',
				targetHostIds: [' ', '']
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		vi.mocked(hostService.list).mockResolvedValueOnce([host({ id: 'host-visible' })] as never);
		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-ssh-command',
				templateId: 'template-1',
				targetHostIds: ['host-visible', 'host-hidden']
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
	});

	it('rejects operation and runbook kind mismatches before queueing jobs', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([host({ id: 'host-1' })] as never);

		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-file-transfer',
				templateId: 'template-1',
				targetHostIds: ['host-1']
			})
		).rejects.toMatchObject({
			issues: ['operationId must match the selected action']
		});
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
	});

	it('rejects runbooks that are not runnable fleet actions before queueing jobs', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([host({ id: 'host-1' })] as never);
		vi.mocked(v6ResourcesService.listAutomationTemplates).mockResolvedValueOnce([
			templateRecord({ id: 'template-note', kind: 'operator_note' })
		] as never);

		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-ssh-command',
				templateId: 'template-note',
				targetHostIds: ['host-1']
			})
		).rejects.toMatchObject({
			issues: ['templateId must reference a runnable fleet action']
		});
		expect(v6ResourcesService.createBackgroundJob).not.toHaveBeenCalled();
	});

	it('queues bulk jobs directly with explicit operation, runbook, deduped targets, and recorded reasons', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			host({ id: 'host-1', workspaceId: 'workspace-1' }),
			host({ id: 'host-2', workspaceId: 'workspace-1' })
		] as never);
		vi.mocked(v6ResourcesService.createBackgroundJob).mockResolvedValueOnce({
			job: job({
				id: 'job-file',
				workspaceId: 'workspace-1',
				templateId: 'template-1',
				kind: 'bulk_ssh_command',
				title: 'Bulk SSH command',
				status: 'running',
				startedAt: now,
				targetCount: 2,
				completedCount: 1
			}),
			targets: []
		} as never);

		const queued = await queueFleetBulkOperation({
			operationId: 'bulk-ssh-command',
			templateId: ' template-1 ',
			targetHostIds: ['host-1', 'host-2', 'host-1'],
			reason: '  maintenance window  ',
			concurrencyLimit: 99
		});

		expect(workspaceService.assertMember).not.toHaveBeenCalled();
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
				kind: 'bulk_ssh_command',
				title: 'Bulk SSH command',
				targetHostIds: ['host-1', 'host-2'],
				concurrencyLimit: 10,
				reason: 'maintenance window',
				request: {
					operationId: 'bulk-ssh-command',
					templateId: 'template-1',
					reviewedHostIds: ['host-1', 'host-2'],
					secretPolicy: 'redacted'
				}
			})
		);
		expect(queued).toMatchObject({
			status: 'queued',
			job: expect.objectContaining({
				id: 'job-file',
				name: 'Bulk SSH command',
				status: 'running',
				targets: 2,
				successful: 1,
				reportUrl: '/fleet/executions/job-file'
			})
		});
		expect(appServer.refresh).toHaveBeenCalledTimes(4);
	});

	it('queues mixed workspace and personal targets without scope blockers', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			host({ id: 'host-1', workspaceId: 'workspace-1' }),
			host({ id: 'host-2', workspaceId: null })
		] as never);
		vi.mocked(v6ResourcesService.createBackgroundJob).mockResolvedValueOnce({
			job: job({ id: 'job-mixed', workspaceId: null, targetCount: 2 }),
			targets: []
		} as never);

		await expect(
			queueFleetBulkOperation({
				operationId: 'bulk-file-transfer',
				templateId: 'builtin:file-transfer',
				targetHostIds: ['host-1', 'host-2'],
				reason: 'run it'
			})
		).resolves.toMatchObject({
			status: 'queued',
			job: expect.objectContaining({ id: 'job-mixed' })
		});
		expect(v6ResourcesService.createBackgroundJob).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				workspaceId: null,
				kind: 'bulk_file_transfer',
				targetHostIds: ['host-1', 'host-2']
			})
		);
	});

	it('uses the default reviewed reason when queueing without an operator reason', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([host({ workspaceId: null })] as never);
		vi.mocked(v6ResourcesService.createBackgroundJob).mockResolvedValueOnce({
			job: job({ reason: 'Fleet operation' }),
			targets: []
		} as never);

		await queueFleetBulkOperation({
			operationId: 'bulk-ssh-command',
			templateId: 'template-1',
			targetHostIds: ['host-1']
		});

		expect(v6ResourcesService.recordOperationReason).not.toHaveBeenCalled();
		expect(v6ResourcesService.createBackgroundJob).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				reason: 'Fleet operation'
			})
		);
	});
});
