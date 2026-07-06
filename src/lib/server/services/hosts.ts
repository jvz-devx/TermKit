import { randomUUID } from 'node:crypto';
import { AesGcmCredentialCrypto } from './crypto';
import {
	credentialPassphraseContext,
	credentialSecretContext,
	stripSensitiveMetadata
} from './credentials';
import { ServiceNotFoundError, ServiceValidationError } from './errors';
import { termixRepository } from './repository';
import type {
	CredentialCrypto,
	CredentialRepository,
	CredentialRecord,
	HostShareInvitationRecord,
	HostShareInvitationRepository,
	HostProtocol,
	HostRecord,
	HostRepository,
	SecretCiphertext,
	UserRepository,
	WorkspaceRepository
} from './types';
import { protocols } from './types';
import { normalizeHostMetadata } from '$lib/termix/host-metadata';

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

export interface HostShareInput {
	hostId?: unknown;
	recipients?: unknown;
	includeCredentials?: unknown;
}

export class HostService {
	constructor(
		private readonly repository: HostRepository &
			Pick<CredentialRepository, 'getCredential' | 'createCredential'> &
			Pick<WorkspaceRepository, 'getWorkspaceMembership'> &
			UserRepository &
			HostShareInvitationRepository = termixRepository,
		private readonly crypto: CredentialCrypto = new AesGcmCredentialCrypto()
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
		const validated = validateHostInput({
			...current,
			...input,
			metadata: mergeHostMetadata(current.metadata, input.metadata)
		});
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

	async share(userId: string, input: HostShareInput): Promise<HostShareInvitationRecord[]> {
		const hostId = asTrimmedString(input.hostId);
		const recipients = normalizeRecipients(input.recipients);
		const includeCredentials = input.includeCredentials === true;
		const issues: string[] = [];
		if (!hostId) issues.push('hostId is required');
		if (recipients.length === 0) issues.push('recipients are required');
		if (issues.length > 0) throw new ServiceValidationError(issues);

		const host = await this.get(userId, hostId!);
		if (host.userId !== userId) throw new ServiceNotFoundError('Host not found');
		if (includeCredentials && !host.credentialId) {
			throw new ServiceValidationError(['host has no credential to share']);
		}

		const credential =
			includeCredentials && host.credentialId
				? await this.repository.getCredential(userId, host.credentialId)
				: null;
		if (includeCredentials && !credential) {
			throw new ServiceValidationError(['credential is no longer available']);
		}

		const users = await Promise.all(
			recipients.map(async (recipient) => ({
				login: recipient,
				user: await this.repository.findUserForShare(recipient)
			}))
		);
		const missing = users.filter((entry) => !entry.user).map((entry) => entry.login);
		const self = users.some((entry) => entry.user?.id === userId);
		if (missing.length || self) {
			throw new ServiceValidationError([
				...missing.map((login) => `user not found: ${login}`),
				...(self ? ['cannot share a host with yourself'] : [])
			]);
		}

		const now = new Date();
		const seenUserIds = new Set<string>();
		const invitations = users.flatMap(({ user }) => {
			if (!user || seenUserIds.has(user.id)) return [];
			seenUserIds.add(user.id);
			return [
				{
					id: randomUUID(),
					senderUserId: userId,
					recipientUserId: user.id,
					hostId: host.id,
					credentialId: includeCredentials ? host.credentialId : null,
					includeCredentials,
					status: 'pending' as const,
					hostSnapshot: snapshotHost(host),
					credentialName: includeCredentials ? (credential?.name ?? null) : null,
					createdAt: now,
					updatedAt: now,
					respondedAt: null
				}
			];
		});

		return Promise.all(
			invitations.map((invitation) => this.repository.createHostShareInvitation(invitation))
		);
	}

	listPendingShares(userId: string): Promise<HostShareInvitationRecord[]> {
		return this.repository.listPendingHostShareInvitations(userId);
	}

	async acceptShare(userId: string, invitationId: string): Promise<HostRecord> {
		const invitation = await this.getPendingShare(userId, invitationId);
		const now = new Date();
		const credentialId = invitation.includeCredentials
			? await this.copySharedCredential(invitation, now)
			: null;
		const host = await this.repository.createHost({
			id: randomUUID(),
			userId,
			workspaceId: null,
			...invitation.hostSnapshot,
			credentialId,
			createdAt: now,
			updatedAt: now
		});

		await this.repository.updateHostShareInvitation(userId, invitation.id, {
			status: 'accepted',
			respondedAt: now,
			updatedAt: now
		});
		return host;
	}

	async declineShare(userId: string, invitationId: string): Promise<void> {
		const invitation = await this.getPendingShare(userId, invitationId);
		const now = new Date();
		const updated = await this.repository.updateHostShareInvitation(userId, invitation.id, {
			status: 'declined',
			respondedAt: now,
			updatedAt: now
		});
		if (!updated) throw new ServiceNotFoundError('Host share invitation not found');
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

	private async getPendingShare(
		userId: string,
		invitationId: string
	): Promise<HostShareInvitationRecord> {
		const invitation = await this.repository.getHostShareInvitation(userId, invitationId);
		if (!invitation || invitation.status !== 'pending') {
			throw new ServiceNotFoundError('Host share invitation not found');
		}
		return invitation;
	}

	private async copySharedCredential(
		invitation: HostShareInvitationRecord,
		now: Date
	): Promise<string> {
		if (!invitation.credentialId) {
			throw new ServiceValidationError(['shared credential is no longer available']);
		}
		const credential = await this.repository.getCredential(
			invitation.senderUserId,
			invitation.credentialId
		);
		if (!credential) {
			throw new ServiceValidationError(['shared credential is no longer available']);
		}
		const id = randomUUID();
		const secret = this.crypto.decrypt(
			{
				ciphertext: credential.encryptedSecret,
				metadata: credential.encryption
			},
			credentialSecretContext(credential.userId, credential.id)
		);
		const encrypted = this.crypto.encrypt(
			secret,
			credentialSecretContext(invitation.recipientUserId, id)
		);
		await this.repository.createCredential({
			id,
			userId: invitation.recipientUserId,
			workspaceId: null,
			name: credential.name,
			kind: credential.kind,
			username: credential.username,
			encryptedSecret: encrypted.ciphertext,
			encryption: encrypted.metadata,
			metadata: this.copyCredentialMetadata(credential, invitation.recipientUserId, id),
			createdAt: now,
			updatedAt: now
		});
		return id;
	}

	private copyCredentialMetadata(
		credential: CredentialRecord,
		recipientUserId: string,
		credentialId: string
	): Record<string, unknown> {
		const metadata = stripSensitiveMetadata(credential.metadata);
		const encryptedPassphrase = credential.metadata.encryptedPassphrase;
		if (credential.kind !== 'ssh_key' || !isEncryptedMetadata(encryptedPassphrase)) return metadata;

		const passphrase = this.crypto.decrypt(
			{
				ciphertext: encryptedPassphrase.ciphertext,
				metadata: encryptedPassphrase.encryption
			},
			credentialPassphraseContext(credential.userId, credential.id)
		);
		const encrypted = this.crypto.encrypt(
			passphrase,
			credentialPassphraseContext(recipientUserId, credentialId)
		);
		return {
			...metadata,
			encryptedPassphrase: {
				ciphertext: encrypted.ciphertext,
				encryption: encrypted.metadata
			}
		};
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

function snapshotHost(host: HostRecord): HostShareInvitationRecord['hostSnapshot'] {
	return {
		name: host.name,
		protocol: host.protocol,
		hostname: host.hostname,
		port: host.port,
		username: host.username,
		folder: host.folder,
		tags: host.tags,
		notes: host.notes,
		metadata: host.metadata
	};
}

function normalizeRecipients(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]+/) : [];
	return [
		...new Set(
			raw.map(asTrimmedString).filter((recipient): recipient is string => Boolean(recipient))
		)
	];
}

function isEncryptedMetadata(
	value: unknown
): value is { ciphertext: string; encryption: SecretCiphertext['metadata'] } {
	if (!isRecord(value)) return false;
	return typeof value.ciphertext === 'string' && isRecord(value.encryption);
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
		metadata: normalizeHostMetadata(input.metadata)
	};
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function asNullableString(value: unknown): string | null {
	return asTrimmedString(value);
}

function mergeHostMetadata(existing: unknown, incoming: unknown): Record<string, unknown> {
	const current = isRecord(existing) ? existing : {};
	const patch = isRecord(incoming) ? incoming : {};
	const merged = { ...current, ...patch };

	for (const key of ['terminalPreferences', 'sshJumpHost', 'ftps']) {
		if (isRecord(current[key]) && isRecord(patch[key])) {
			merged[key] = { ...current[key], ...patch[key] };
		}
	}

	return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const hostService = new HostService();
