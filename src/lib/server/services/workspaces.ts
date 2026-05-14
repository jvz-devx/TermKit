import { randomUUID } from 'node:crypto';
import { ServiceNotFoundError, ServiceValidationError } from './errors';
import { termixRepository } from './repository';
import type {
	WorkspaceMemberRole,
	WorkspaceMembershipRecord,
	WorkspaceRecord,
	WorkspaceRepository
} from './types';
import { workspaceMemberRoles } from './types';

export interface WorkspaceInput {
	name?: unknown;
	metadata?: unknown;
}

export interface WorkspaceMemberInput {
	userId?: unknown;
	role?: unknown;
}

export class WorkspaceService {
	constructor(private readonly repository: WorkspaceRepository = termixRepository) {}

	list(userId: string): Promise<WorkspaceRecord[]> {
		return this.repository.listWorkspaces(userId);
	}

	async get(userId: string, id: string): Promise<WorkspaceRecord> {
		const workspace = await this.repository.getWorkspace(userId, id);
		if (!workspace) throw new ServiceNotFoundError('Workspace not found');
		return workspace;
	}

	async create(ownerUserId: string, input: WorkspaceInput): Promise<WorkspaceRecord> {
		const now = new Date();
		const validated = validateWorkspaceInput(input);
		const workspace = await this.repository.createWorkspace({
			id: randomUUID(),
			name: validated.name,
			metadata: validated.metadata,
			createdAt: now,
			updatedAt: now
		});

		await this.repository.createWorkspaceMembership({
			id: randomUUID(),
			workspaceId: workspace.id,
			userId: ownerUserId,
			role: 'owner',
			createdAt: now,
			updatedAt: now
		});

		return workspace;
	}

	async rename(
		ownerUserId: string,
		workspaceId: string,
		input: WorkspaceInput
	): Promise<WorkspaceRecord> {
		await this.assertOwner(ownerUserId, workspaceId);
		const validated = validateWorkspaceInput(input);
		const updated = await this.repository.updateWorkspace(workspaceId, {
			name: validated.name,
			metadata: validated.metadata,
			updatedAt: new Date()
		});
		if (!updated) throw new ServiceNotFoundError('Workspace not found');
		return updated;
	}

	async listMembers(userId: string, workspaceId: string): Promise<WorkspaceMembershipRecord[]> {
		await this.assertMember(userId, workspaceId);
		return this.repository.listWorkspaceMemberships(workspaceId);
	}

	async addMember(
		ownerUserId: string,
		workspaceId: string,
		input: WorkspaceMemberInput
	): Promise<WorkspaceMembershipRecord> {
		await this.assertOwner(ownerUserId, workspaceId);
		const validated = validateWorkspaceMemberInput(input);
		const now = new Date();
		const existing = await this.repository.getWorkspaceMembership(workspaceId, validated.userId);
		if (existing) return existing;

		return this.repository.createWorkspaceMembership({
			id: randomUUID(),
			workspaceId,
			userId: validated.userId,
			role: validated.role,
			createdAt: now,
			updatedAt: now
		});
	}

	async setMemberRole(
		ownerUserId: string,
		workspaceId: string,
		memberUserId: string,
		role: WorkspaceMemberRole
	): Promise<WorkspaceMembershipRecord> {
		await this.assertOwner(ownerUserId, workspaceId);
		if (!workspaceMemberRoles.includes(role)) {
			throw new ServiceValidationError(['role must be owner or member']);
		}
		const updated = await this.repository.updateWorkspaceMembership(workspaceId, memberUserId, {
			role,
			updatedAt: new Date()
		});
		if (!updated) throw new ServiceNotFoundError('Workspace membership not found');
		return updated;
	}

	async removeMember(
		ownerUserId: string,
		workspaceId: string,
		memberUserId: string
	): Promise<void> {
		await this.assertOwner(ownerUserId, workspaceId);
		if (ownerUserId === memberUserId) {
			throw new ServiceValidationError(['workspace owners cannot remove their own membership']);
		}
		const deleted = await this.repository.deleteWorkspaceMembership(workspaceId, memberUserId);
		if (!deleted) throw new ServiceNotFoundError('Workspace membership not found');
	}

	async assertMember(userId: string, workspaceId: string): Promise<WorkspaceMembershipRecord> {
		const membership = await this.repository.getWorkspaceMembership(workspaceId, userId);
		if (!membership) throw new ServiceNotFoundError('Workspace not found');
		return membership;
	}

	async assertOwner(userId: string, workspaceId: string): Promise<WorkspaceMembershipRecord> {
		const membership = await this.assertMember(userId, workspaceId);
		if (membership.role !== 'owner') {
			throw new ServiceValidationError(['workspace owner role is required']);
		}
		return membership;
	}
}

function validateWorkspaceInput(input: WorkspaceInput): {
	name: string;
	metadata: Record<string, unknown>;
} {
	const issues: string[] = [];
	const name = asTrimmedString(input.name);
	if (!name) issues.push('name is required');
	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		name: name!,
		metadata: isRecord(input.metadata) ? input.metadata : {}
	};
}

function validateWorkspaceMemberInput(input: WorkspaceMemberInput): {
	userId: string;
	role: WorkspaceMemberRole;
} {
	const issues: string[] = [];
	const userId = asTrimmedString(input.userId);
	const role = input.role ?? 'member';
	if (!userId) issues.push('userId is required');
	if (!workspaceMemberRoles.includes(role as WorkspaceMemberRole)) {
		issues.push('role must be owner or member');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		userId: userId!,
		role: role as WorkspaceMemberRole
	};
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const workspaceService = new WorkspaceService();
