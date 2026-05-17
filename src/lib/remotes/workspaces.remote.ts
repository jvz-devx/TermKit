import { command, getRequestEvent, query } from '$app/server';
import { credentialService } from '$lib/server/services/credentials';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { hostService } from '$lib/server/services/hosts';
import type {
	CredentialKind,
	HostProtocol,
	WorkspaceMemberRole,
	WorkspaceRecord
} from '$lib/server/services/types';
import { workspaceService } from '$lib/server/services/workspaces';

export type WorkspaceRole = 'owner' | 'member';

export type WorkspaceCapabilities = {
	persistentWorkspaces: boolean;
	renameWorkspaces: boolean;
	membership: boolean;
	removeMembers: boolean;
	inventoryAssignments: boolean;
};

export type WorkspaceMemberSummary = {
	id: string;
	name: string;
	role: WorkspaceRole;
	currentUser: boolean;
};

export type WorkspaceSummary = {
	id: string;
	name: string;
	role: WorkspaceRole;
	isPersonal: boolean;
	memberCount: number;
	hostCount: number;
	credentialCount: number;
	createdAt: string;
	updatedAt: string;
	members: WorkspaceMemberSummary[];
	hostIds: string[];
	credentialIds: string[];
};

export type WorkspaceHostSummary = {
	id: string;
	name: string;
	protocol: HostProtocol;
	hostname: string;
	username: string | null;
	credentialId: string | null;
	credentialName: string | null;
	folder: string | null;
	tags: string[];
	workspaceIds: string[];
};

export type WorkspaceCredentialSummary = {
	id: string;
	name: string;
	kind: CredentialKind;
	username: string | null;
	usedBy: number;
	workspaceIds: string[];
};

export type WorkspaceOverview = {
	capabilities: WorkspaceCapabilities;
	currentUser: WorkspaceMemberSummary;
	workspaces: WorkspaceSummary[];
	hosts: WorkspaceHostSummary[];
	credentials: WorkspaceCredentialSummary[];
};

export type WorkspaceMutationInput = {
	workspaceId?: unknown;
	name?: unknown;
};

export type WorkspaceMemberMutationInput = {
	workspaceId?: unknown;
	memberId?: unknown;
	memberName?: unknown;
	role?: unknown;
};

export type WorkspaceInventoryAssignmentInput = {
	workspaceId?: unknown;
	itemId?: unknown;
	assigned?: unknown;
};

const fallbackCapabilities: WorkspaceCapabilities = {
	persistentWorkspaces: true,
	renameWorkspaces: true,
	membership: true,
	removeMembers: true,
	inventoryAssignments: true
};

export const listWorkspaceOverview = query(async (): Promise<WorkspaceOverview> => {
	const user = requireRemoteUser();
	const [workspaces, hosts, credentials] = await Promise.all([
		workspaceService.list(user.id),
		hostService.list(user.id),
		credentialService.list(user.id)
	]);
	const membershipEntries = await Promise.all(
		workspaces.map(async (workspace) => ({
			workspace,
			members: await workspaceService.listMembers(user.id, workspace.id)
		}))
	);
	const credentialNames = new Map(
		credentials.map((credential) => [credential.id, credential.name])
	);
	const personalWorkspaceId = `personal:${user.id}`;
	const now = new Date().toISOString();
	const currentUser: WorkspaceMemberSummary = {
		id: user.id,
		name: user.username,
		role: 'owner',
		currentUser: true
	};

	const workspaceSummaries = membershipEntries.map(({ workspace, members }) =>
		toWorkspaceSummary({
			workspace,
			members,
			currentUserId: user.id,
			hosts: hosts.filter((host) => host.workspaceId === workspace.id),
			credentials: credentials.filter((credential) => credential.workspaceId === workspace.id)
		})
	);
	const privateHosts = hosts.filter((host) => !host.workspaceId);
	const privateCredentials = credentials.filter((credential) => !credential.workspaceId);
	const personalWorkspace: WorkspaceSummary = {
		id: personalWorkspaceId,
		name: 'Personal workspace',
		role: 'owner',
		isPersonal: true,
		memberCount: 1,
		hostCount: privateHosts.length,
		credentialCount: privateCredentials.length,
		createdAt: now,
		updatedAt: now,
		members: [currentUser],
		hostIds: privateHosts.map((host) => host.id),
		credentialIds: privateCredentials.map((credential) => credential.id)
	};

	return {
		capabilities: fallbackCapabilities,
		currentUser,
		workspaces: [personalWorkspace, ...workspaceSummaries].sort((left, right) =>
			left.name.localeCompare(right.name)
		),
		hosts: hosts
			.map(
				(host): WorkspaceHostSummary => ({
					id: host.id,
					name: host.name,
					protocol: host.protocol,
					hostname: host.hostname,
					username: host.username,
					credentialId: host.credentialId,
					credentialName: host.credentialId
						? (credentialNames.get(host.credentialId) ?? null)
						: null,
					folder: host.folder,
					tags: host.tags,
					workspaceIds: [host.workspaceId ?? personalWorkspaceId]
				})
			)
			.sort((left, right) => left.name.localeCompare(right.name)),
		credentials: credentials
			.map(
				(credential): WorkspaceCredentialSummary => ({
					id: credential.id,
					name: credential.name,
					kind: credential.kind,
					username: credential.username,
					usedBy: hosts.filter((host) => host.credentialId === credential.id).length,
					workspaceIds: [credential.workspaceId ?? personalWorkspaceId]
				})
			)
			.sort((left, right) => left.name.localeCompare(right.name))
	};
});

export const createWorkspace = command<WorkspaceMutationInput, WorkspaceSummary>(
	'unchecked',
	async (input) => {
		const user = requireRemoteUser();
		const workspace = await workspaceService.create(user.id, {
			name: requireWorkspaceName(input.name)
		});
		void listWorkspaceOverview().refresh();
		return toWorkspaceSummary({
			workspace,
			members: [
				{
					userId: user.id,
					role: 'owner',
					createdAt: workspace.createdAt,
					updatedAt: workspace.updatedAt
				}
			],
			currentUserId: user.id,
			hosts: [],
			credentials: []
		});
	}
);

export const renameWorkspace = command<WorkspaceMutationInput, void>('unchecked', async (input) => {
	const user = requireRemoteUser();
	const workspaceId = requirePersistentWorkspaceId(input.workspaceId);
	await workspaceService.rename(user.id, workspaceId, { name: requireWorkspaceName(input.name) });
	void listWorkspaceOverview().refresh();
});

export const setWorkspaceMember = command<WorkspaceMemberMutationInput, void>(
	'unchecked',
	async (input) => {
		const user = requireRemoteUser();
		const workspaceId = requirePersistentWorkspaceId(input.workspaceId);
		const role = input.role;
		if (role !== 'owner' && role !== 'member') {
			throw new ServiceValidationError(['role must be owner or member']);
		}
		if (typeof input.memberId === 'string' && input.memberId) {
			await workspaceService.setMemberRole(user.id, workspaceId, input.memberId, role);
		} else {
			const userId = requireUserId(input.memberName);
			await workspaceService.addMember(user.id, workspaceId, { userId, role });
		}
		void listWorkspaceOverview().refresh();
	}
);

export const removeWorkspaceMember = command<WorkspaceMemberMutationInput, void>(
	'unchecked',
	async (input) => {
		const user = requireRemoteUser();
		const workspaceId = requirePersistentWorkspaceId(input.workspaceId);
		if (typeof input.memberId !== 'string' || !input.memberId) {
			throw new ServiceValidationError(['memberId is required']);
		}
		await workspaceService.removeMember(user.id, workspaceId, input.memberId);
		void listWorkspaceOverview().refresh();
	}
);

export const setWorkspaceHostAssignment = command<WorkspaceInventoryAssignmentInput, void>(
	'unchecked',
	async (input) => {
		const user = requireRemoteUser();
		const workspaceId = requirePersistentWorkspaceId(input.workspaceId);
		requireItemAssignment(input);
		await hostService.update(user.id, input.itemId as string, {
			workspaceId: assignmentWorkspaceId(workspaceId, input.assigned)
		});
		void listWorkspaceOverview().refresh();
	}
);

export const setWorkspaceCredentialAssignment = command<WorkspaceInventoryAssignmentInput, void>(
	'unchecked',
	async (input) => {
		const user = requireRemoteUser();
		const workspaceId = requirePersistentWorkspaceId(input.workspaceId);
		requireItemAssignment(input);
		await credentialService.update(user.id, input.itemId as string, {
			workspaceId: assignmentWorkspaceId(workspaceId, input.assigned)
		});
		void listWorkspaceOverview().refresh();
	}
);

function requireRemoteUser(): { id: string; username: string } {
	const user = getRequestEvent().locals.user;
	if (!user) throw new ServiceUnauthorizedError();
	return { id: user.id, username: user.username };
}

function requireWorkspaceId(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new ServiceValidationError(['workspaceId is required']);
	}
	return value;
}

function requirePersistentWorkspaceId(value: unknown): string {
	const workspaceId = requireWorkspaceId(value);
	if (workspaceId.startsWith('personal:')) {
		throw new ServiceValidationError([
			'personal workspace cannot be managed as a shared workspace'
		]);
	}
	return workspaceId;
}

function requireWorkspaceName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new ServiceValidationError(['name is required']);
	}
	return value.trim();
}

function requireUserId(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new ServiceValidationError(['userId is required']);
	}
	return value.trim();
}

function requireItemAssignment(input: WorkspaceInventoryAssignmentInput): void {
	if (typeof input.itemId !== 'string' || !input.itemId) {
		throw new ServiceValidationError(['itemId is required']);
	}
	if (typeof input.assigned !== 'boolean') {
		throw new ServiceValidationError(['assigned must be a boolean']);
	}
}

function assignmentWorkspaceId(workspaceId: string, assigned: unknown): string | null {
	if (!assigned) return null;
	return workspaceId.startsWith('personal:') ? null : workspaceId;
}

function toWorkspaceSummary(input: {
	workspace: WorkspaceRecord;
	members: {
		userId: string;
		role: WorkspaceMemberRole;
		createdAt: Date;
		updatedAt: Date;
	}[];
	currentUserId: string;
	hosts: { id: string }[];
	credentials: { id: string }[];
}): WorkspaceSummary {
	const currentUserRole =
		input.members.find((member) => member.userId === input.currentUserId)?.role ?? 'member';

	return {
		id: input.workspace.id,
		name: input.workspace.name,
		role: currentUserRole,
		isPersonal: false,
		memberCount: input.members.length,
		hostCount: input.hosts.length,
		credentialCount: input.credentials.length,
		createdAt: input.workspace.createdAt.toISOString(),
		updatedAt: input.workspace.updatedAt.toISOString(),
		members: input.members
			.map(
				(member): WorkspaceMemberSummary => ({
					id: member.userId,
					name: member.userId,
					role: member.role,
					currentUser: member.userId === input.currentUserId
				})
			)
			.sort((left, right) => left.name.localeCompare(right.name)),
		hostIds: input.hosts.map((host) => host.id),
		credentialIds: input.credentials.map((credential) => credential.id)
	};
}
