import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { credentialService } from '$lib/server/services/credentials';
import { hostService } from '$lib/server/services/hosts';
import { workspaceService } from '$lib/server/services/workspaces';
import {
	createWorkspace,
	listWorkspaceOverview,
	renameWorkspace,
	removeWorkspaceMember,
	setWorkspaceCredentialAssignment,
	setWorkspaceHostAssignment,
	setWorkspaceMember
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
		rename: vi.fn(),
		addMember: vi.fn(),
		setMemberRole: vi.fn(),
		removeMember: vi.fn()
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

	it('returns default personal workspace state when shared inventory is empty', async () => {
		vi.mocked(workspaceService.list).mockResolvedValueOnce([] as never);
		vi.mocked(hostService.list).mockResolvedValueOnce([] as never);
		vi.mocked(credentialService.list).mockResolvedValueOnce([] as never);

		const overview = await listWorkspaceOverview();

		expect(overview.capabilities).toEqual({
			persistentWorkspaces: true,
			renameWorkspaces: true,
			membership: true,
			removeMembers: true,
			inventoryAssignments: true
		});
		expect(overview.currentUser).toEqual({
			id: 'user-1',
			name: 'ada',
			role: 'owner',
			currentUser: true
		});
		expect(overview.workspaces).toHaveLength(1);
		expect(overview.workspaces[0]).toMatchObject({
			id: 'personal:user-1',
			name: 'Personal workspace',
			role: 'owner',
			isPersonal: true,
			memberCount: 1,
			hostCount: 0,
			credentialCount: 0,
			hostIds: [],
			credentialIds: []
		});
		expect(overview.hosts).toEqual([]);
		expect(overview.credentials).toEqual([]);
	});

	it('marks the current user as a member when another owner owns the workspace', async () => {
		vi.mocked(workspaceService.list).mockResolvedValueOnce([
			{ ...workspace, ownerId: 'user-owner' }
		] as never);
		vi.mocked(workspaceService.listMembers).mockResolvedValueOnce([
			{ userId: 'user-owner', role: 'owner', createdAt, updatedAt: createdAt },
			{ userId: 'user-1', role: 'member', createdAt, updatedAt: createdAt }
		] as never);
		vi.mocked(hostService.list).mockResolvedValueOnce([] as never);
		vi.mocked(credentialService.list).mockResolvedValueOnce([] as never);

		const overview = await listWorkspaceOverview();
		const sharedWorkspace = overview.workspaces.find((entry) => entry.id === 'workspace-1');

		expect(sharedWorkspace).toMatchObject({
			id: 'workspace-1',
			role: 'member',
			memberCount: 2,
			members: [
				{ id: 'user-1', name: 'user-1', role: 'member', currentUser: true },
				{ id: 'user-owner', name: 'user-owner', role: 'owner', currentUser: false }
			]
		});
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

	it('creates a persistent workspace with the current user as owner', async () => {
		vi.mocked(workspaceService.create).mockResolvedValueOnce({
			...workspace,
			name: 'Production'
		} as never);

		const summary = await createWorkspace({ name: '  Production  ' });

		expect(workspaceService.create).toHaveBeenCalledWith('user-1', { name: 'Production' });
		expect(summary).toMatchObject({
			id: 'workspace-1',
			name: 'Production',
			role: 'owner',
			isPersonal: false,
			memberCount: 1,
			hostCount: 0,
			credentialCount: 0,
			members: [{ id: 'user-1', name: 'user-1', role: 'owner', currentUser: true }]
		});
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});

	it('rejects workspace mutations without auth before invoking services', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/workspaces')
		};

		await expect(createWorkspace({ name: 'Ops' })).rejects.toBeInstanceOf(ServiceUnauthorizedError);
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

	it('adds members, updates roles, and removes members through the membership service', async () => {
		vi.mocked(workspaceService.addMember).mockResolvedValueOnce(undefined as never);
		vi.mocked(workspaceService.setMemberRole).mockResolvedValueOnce(undefined as never);
		vi.mocked(workspaceService.removeMember).mockResolvedValueOnce(undefined as never);

		await setWorkspaceMember({
			workspaceId: 'workspace-1',
			memberName: ' user-2 ',
			role: 'member'
		});
		await setWorkspaceMember({
			workspaceId: 'workspace-1',
			memberId: 'user-2',
			role: 'owner'
		});
		await removeWorkspaceMember({ workspaceId: 'workspace-1', memberId: 'user-2' });

		expect(workspaceService.addMember).toHaveBeenCalledWith('user-1', 'workspace-1', {
			userId: 'user-2',
			role: 'member'
		});
		expect(workspaceService.setMemberRole).toHaveBeenCalledWith(
			'user-1',
			'workspace-1',
			'user-2',
			'owner'
		);
		expect(workspaceService.removeMember).toHaveBeenCalledWith('user-1', 'workspace-1', 'user-2');
		expect(appServer.refresh).toHaveBeenCalledTimes(3);
	});

	it('validates membership role and member id edge cases before service calls', async () => {
		await expect(
			setWorkspaceMember({ workspaceId: 'workspace-1', memberName: 'user-2', role: 'admin' })
		).rejects.toBeInstanceOf(ServiceValidationError);
		await expect(
			removeWorkspaceMember({ workspaceId: 'workspace-1', memberId: '' })
		).rejects.toBeInstanceOf(ServiceValidationError);

		expect(workspaceService.addMember).not.toHaveBeenCalled();
		expect(workspaceService.setMemberRole).not.toHaveBeenCalled();
		expect(workspaceService.removeMember).not.toHaveBeenCalled();
	});

	it('assigns and removes hosts and credentials from persistent workspaces', async () => {
		vi.mocked(hostService.update).mockResolvedValue(undefined as never);
		vi.mocked(credentialService.update).mockResolvedValue(undefined as never);

		await setWorkspaceHostAssignment({
			workspaceId: 'workspace-1',
			itemId: 'host-1',
			assigned: true
		});
		await setWorkspaceHostAssignment({
			workspaceId: 'workspace-1',
			itemId: 'host-1',
			assigned: false
		});
		await setWorkspaceCredentialAssignment({
			workspaceId: 'workspace-1',
			itemId: 'cred-1',
			assigned: true
		});
		await setWorkspaceCredentialAssignment({
			workspaceId: 'workspace-1',
			itemId: 'cred-1',
			assigned: false
		});

		expect(hostService.update).toHaveBeenNthCalledWith(1, 'user-1', 'host-1', {
			workspaceId: 'workspace-1'
		});
		expect(hostService.update).toHaveBeenNthCalledWith(2, 'user-1', 'host-1', {
			workspaceId: null
		});
		expect(credentialService.update).toHaveBeenNthCalledWith(1, 'user-1', 'cred-1', {
			workspaceId: 'workspace-1'
		});
		expect(credentialService.update).toHaveBeenNthCalledWith(2, 'user-1', 'cred-1', {
			workspaceId: null
		});
		expect(appServer.refresh).toHaveBeenCalledTimes(4);
	});

	it('validates inventory assignment payloads before service calls', async () => {
		await expect(
			setWorkspaceCredentialAssignment({
				workspaceId: 'workspace-1',
				itemId: '',
				assigned: true
			})
		).rejects.toBeInstanceOf(ServiceValidationError);
		await expect(
			setWorkspaceCredentialAssignment({
				workspaceId: 'workspace-1',
				itemId: 'cred-1',
				assigned: 'yes'
			})
		).rejects.toBeInstanceOf(ServiceValidationError);

		expect(credentialService.update).not.toHaveBeenCalled();
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
