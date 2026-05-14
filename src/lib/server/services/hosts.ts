import { randomUUID } from 'node:crypto';
import { ServiceNotFoundError, ServiceValidationError } from './errors';
import { termixRepository } from './repository';
import type {
	CredentialRepository,
	HostProtocol,
	HostRecord,
	HostRepository,
	WorkspaceRepository
} from './types';
import { protocols } from './types';

export interface HostInput {
	name?: unknown;
	protocol?: unknown;
	hostname?: unknown;
	port?: unknown;
	workspaceId?: unknown;
	username?: unknown;
	credentialId?: unknown;
	folder?: unknown;
	tags?: unknown;
	notes?: unknown;
	metadata?: unknown;
}

export class HostService {
	constructor(
		private readonly repository: HostRepository &
			Pick<CredentialRepository, 'getCredential'> &
			Pick<WorkspaceRepository, 'getWorkspaceMembership'> = termixRepository
	) {}

	list(userId: string): Promise<HostRecord[]> {
		return this.repository.listHosts(userId);
	}

	async get(userId: string, id: string): Promise<HostRecord> {
		const host = await this.repository.getHost(userId, id);
		if (!host) throw new ServiceNotFoundError('Host not found');
		return host;
	}

	async create(userId: string, input: HostInput): Promise<HostRecord> {
		const now = new Date();
		const validated = validateHostInput(input);
		await this.assertWorkspaceOwner(userId, validated.workspaceId);
		await this.assertCredentialMatchesScope(userId, validated.credentialId, validated.workspaceId);

		return this.repository.createHost({
			id: randomUUID(),
			userId,
			...validated,
			createdAt: now,
			updatedAt: now
		});
	}

	async update(userId: string, id: string, input: HostInput): Promise<HostRecord> {
		const current = await this.get(userId, id);
		const validated = validateHostInput({ ...current, ...input });
		await this.assertWorkspaceOwner(userId, current.workspaceId);
		await this.assertWorkspaceOwner(userId, validated.workspaceId);
		await this.assertCredentialMatchesScope(userId, validated.credentialId, validated.workspaceId);
		const updated = await this.repository.updateHost(userId, id, {
			...validated,
			updatedAt: new Date()
		});

		if (!updated) throw new ServiceNotFoundError('Host not found');
		return updated;
	}

	async delete(userId: string, id: string): Promise<void> {
		const current = await this.get(userId, id);
		await this.assertWorkspaceOwner(userId, current.workspaceId);
		const deleted = await this.repository.deleteHost(userId, id);
		if (!deleted) throw new ServiceNotFoundError('Host not found');
	}

	private async assertWorkspaceOwner(userId: string, workspaceId: string | null): Promise<void> {
		if (!workspaceId) return;
		const membership = await this.repository.getWorkspaceMembership(workspaceId, userId);
		if (!membership) {
			throw new ServiceValidationError([
				'workspaceId must reference a workspace the user belongs to'
			]);
		}
		if (membership.role !== 'owner') {
			throw new ServiceValidationError(['workspace owner role is required']);
		}
	}

	private async assertCredentialMatchesScope(
		userId: string,
		credentialId: string | null,
		workspaceId: string | null
	): Promise<void> {
		if (!credentialId) return;

		const credential = await this.repository.getCredential(userId, credentialId);
		if (!credential) {
			throw new ServiceValidationError([
				'credentialId must reference an existing credential owned by the user'
			]);
		}
		if (credential.workspaceId !== workspaceId) {
			throw new ServiceValidationError(['credentialId must belong to the same scope as the host']);
		}
	}
}

export function validateHostInput(
	input: HostInput
): Omit<HostRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
	const issues: string[] = [];
	const name = asTrimmedString(input.name);
	const protocol = input.protocol;
	const hostname = asTrimmedString(input.hostname);
	const port = Number(input.port);

	if (!name) issues.push('name is required');
	if (!protocols.includes(protocol as HostProtocol))
		issues.push('protocol must be ssh, rdp, vnc, telnet, ftp, or ftps');
	if (!hostname) issues.push('hostname is required');
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		issues.push('port must be an integer between 1 and 65535');
	}

	const tags = Array.isArray(input.tags)
		? input.tags.map(asTrimmedString).filter((tag): tag is string => Boolean(tag))
		: [];

	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		name: name!,
		protocol: protocol as HostProtocol,
		hostname: hostname!,
		port,
		workspaceId: asNullableString(input.workspaceId),
		username: asNullableString(input.username),
		credentialId: asNullableString(input.credentialId),
		folder: asNullableString(input.folder),
		tags: [...new Set(tags)],
		notes: asNullableString(input.notes),
		metadata: isRecord(input.metadata) ? input.metadata : {}
	};
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function asNullableString(value: unknown): string | null {
	return asTrimmedString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const hostService = new HostService();
