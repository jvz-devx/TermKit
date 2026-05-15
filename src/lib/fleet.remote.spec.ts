import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { hostService } from '$lib/server/services/hosts';
import { v6ResourcesService } from '$lib/server/services/v6-resources';
import { workspaceService } from '$lib/server/services/workspaces';
import {
	createFleetAutomationTemplate,
	decideFleetApproval,
	getFleetOverview
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
		decideApproval: vi.fn()
	}
}));

vi.mock('$lib/server/services/workspaces', () => ({
	workspaceService: {
		list: vi.fn()
	}
}));

describe('fleet remote functions', () => {
	const now = new Date('2026-05-14T10:00:00.000Z');

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
	});

	it('builds fleet overview from user-visible service resources', async () => {
		vi.mocked(hostService.list).mockResolvedValueOnce([
			{
				id: 'host-1',
				name: 'API',
				protocol: 'ssh',
				hostname: 'api.internal',
				username: 'deploy',
				tags: ['production', 'region:eu'],
				folder: null,
				metadata: {},
				workspaceId: null
			}
		] as never);
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

	it('rejects fleet overview access before service calls when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/fleet')
		};

		await expect(getFleetOverview()).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(hostService.list).not.toHaveBeenCalled();
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
		vi.mocked(v6ResourcesService.createAutomationTemplate).mockResolvedValueOnce({
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
			updatedAt: now
		} as never);

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
});
