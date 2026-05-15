import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { credentialService } from '$lib/server/services/credentials';
import { hostService } from '$lib/server/services/hosts';
import { workspaceService } from '$lib/server/services/workspaces';
import {
	createWorkspace,
	listWorkspaceOverview,
	renameWorkspace,
	setWorkspaceHostAssignment
} from './workspaces.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: { user: { id: 'user-1', username: 'ada' } } as {
			user?: { id: string; username: string };
		},
		url: new URL('https://termix.test/workspaces')
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

vi.mock('$lib/server/services/credentials', () => ({
	credentialService: {
		list: vi.fn(),
		update: vi.fn()
	}
}));

vi.mock('$lib/server/services/hosts', () => ({
	hostService: {
		list: vi.fn(),
		update: vi.fn()
	}
}));

vi.mock('$lib/server/services/workspaces', () => ({
	workspaceService: {
		list: vi.fn(),
		listMembers: vi.fn(),
		create: vi.fn(),
		rename: vi.fn()
	}
}));

describe('workspace remote functions', () => {
	const createdAt = new Date('2026-05-14T10:00:00.000Z');
	const workspace = {
		id: 'workspace-1',
		ownerId: 'user-1',
		name: 'Ops',
		createdAt,
		updatedAt: createdAt
	};

	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: { user: { id: 'user-1', username: 'ada' } },
			url: new URL('https://termix.test/workspaces')
		};
	});

	it('builds a workspace overview from service-owned inventory', async () => {
		vi.mocked(workspaceService.list).mockResolvedValueOnce([workspace] as never);
		vi.mocked(workspaceService.listMembers).mockResolvedValueOnce([
			{ userId: 'user-1', role: 'owner', createdAt, updatedAt: createdAt }
		] as never);
		vi.mocked(hostService.list).mockResolvedValueOnce([
			{
				id: 'host-1',
				name: 'SSH',
				protocol: 'ssh',
				hostname: 'ssh.internal',
				username: 'deploy',
				credentialId: 'cred-1',
				folder: null,
				tags: [],
				workspaceId: 'workspace-1'
			}
		] as never);
		vi.mocked(credentialService.list).mockResolvedValueOnce([
			{
				id: 'cred-1',
				name: 'Key',
				kind: 'ssh_key',
				username: 'deploy',
				workspaceId: 'workspace-1'
			}
		] as never);

		const overview = await listWorkspaceOverview();

		expect(overview.currentUser).toMatchObject({ id: 'user-1', name: 'ada', role: 'owner' });
		expect(overview.workspaces).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'personal:user-1', isPersonal: true }),
				expect.objectContaining({ id: 'workspace-1', hostCount: 1, credentialCount: 1 })
			])
		);
		expect(workspaceService.listMembers).toHaveBeenCalledWith('user-1', 'workspace-1');
	});

	it('rejects workspace reads without invoking services when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/workspaces')
		};

		await expect(listWorkspaceOverview()).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(workspaceService.list).not.toHaveBeenCalled();
	});

	it('validates workspace names before create service calls', async () => {
		await expect(createWorkspace({ name: '   ' })).rejects.toBeInstanceOf(ServiceValidationError);
		expect(workspaceService.create).not.toHaveBeenCalled();
	});

	it('renames persistent workspaces and refreshes the overview', async () => {
		vi.mocked(workspaceService.rename).mockResolvedValueOnce(undefined as never);

		await expect(renameWorkspace({ workspaceId: 'workspace-1', name: 'Prod Ops' })).resolves.toBe(
			undefined
		);
		expect(workspaceService.rename).toHaveBeenCalledWith('user-1', 'workspace-1', {
			name: 'Prod Ops'
		});
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('blocks shared-workspace mutations against the personal workspace placeholder', async () => {
		await expect(
			setWorkspaceHostAssignment({
				workspaceId: 'personal:user-1',
				itemId: 'host-1',
				assigned: true
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		expect(hostService.update).not.toHaveBeenCalled();
	});
});
