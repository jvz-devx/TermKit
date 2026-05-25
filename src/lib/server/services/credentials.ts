import { randomUUID } from 'node:crypto';
import type { CredentialEncryptionContext } from '$lib/server/crypto/credentials';
import { AesGcmCredentialCrypto } from './crypto';
import { ServiceNotFoundError, ServiceValidationError } from './errors';
import { termixRepository } from './repository';
import type {
	CredentialCrypto,
	CredentialKind,
	CredentialRecord,
	CredentialRepository,
	HostRepository,
	WorkspaceRepository
} from './types';
import { credentialKinds } from './types';

const encryptedPassphraseMetadataKey = 'encryptedPassphrase';
const sensitiveMetadataKeys = new Set([
	encryptedPassphraseMetadataKey.toLowerCase(),
	'passphrase',
	'password',
	'secret',
	'token',
	'apikey',
	'accesstoken',
	'refreshtoken',
	'privatekey',
	'private_key'
]);

export interface CredentialInput {
	name?: unknown;
	kind?: unknown;
	workspaceId?: unknown;
	username?: unknown;
	secret?: unknown;
	metadata?: unknown;
	rdpDomain?: unknown;
}

export type PublicCredentialRecord = Omit<CredentialRecord, 'encryptedSecret' | 'encryption'>;

export class CredentialService {
	constructor(
		private readonly repository: CredentialRepository &
			Pick<HostRepository, 'listHosts'> &
			Pick<WorkspaceRepository, 'getWorkspaceMembership'> = termixRepository,
		private readonly crypto: CredentialCrypto = new AesGcmCredentialCrypto()
	) {}

	async list(userId: string): Promise<PublicCredentialRecord[]> {
		return (await this.repository.listCredentials(userId)).map(redactCredential);
	}

	async get(userId: string, id: string): Promise<PublicCredentialRecord> {
		const credential = await this.repository.getCredential(userId, id);
		if (!credential) throw new ServiceNotFoundError('Credential not found');
		return redactCredential(credential);
	}

	async create(userId: string, input: CredentialInput): Promise<PublicCredentialRecord> {
		const now = new Date();
		const validated = validateCredentialInput(input, true);
		await this.assertWorkspaceOwner(userId, validated.workspaceId);
		const id = randomUUID();
		const encrypted = this.crypto.encrypt(validated.secret!, credentialSecretContext(userId, id));
		const metadata = this.protectMetadata(userId, id, validated.kind!, validated.metadata);
		const credential = await this.repository.createCredential({
			id,
			userId,
			workspaceId: validated.workspaceId,
			name: validated.name!,
			kind: validated.kind!,
			username: validated.username,
			encryptedSecret: encrypted.ciphertext,
			encryption: encrypted.metadata,
			metadata,
			createdAt: now,
			updatedAt: now
		});

		return redactCredential(credential);
	}

	async update(
		userId: string,
		id: string,
		input: CredentialInput
	): Promise<PublicCredentialRecord> {
		const current = await this.repository.getCredential(userId, id);
		if (!current) throw new ServiceNotFoundError('Credential not found');

		const validated = validateCredentialInput({ ...current, ...input }, false);
		await this.assertWorkspaceOwner(userId, current.workspaceId);
		await this.assertWorkspaceOwner(userId, validated.workspaceId);
		if (current.workspaceId !== validated.workspaceId) {
			await this.assertReferencedHostsRemainInScope(userId, id, validated.workspaceId);
		}
		const kindChanged = validated.kind !== current.kind;
		if (kindChanged && validated.secret === undefined) {
			throw new ServiceValidationError(['secret is required when kind changes']);
		}

		const metadata =
			'metadata' in input || 'rdpDomain' in input || kindChanged
				? this.protectMetadata(userId, id, validated.kind!, validated.metadata)
				: current.metadata;
		const secretPatch =
			validated.secret === undefined
				? {}
				: (() => {
						const encrypted = this.crypto.encrypt(
							validated.secret,
							credentialSecretContext(userId, id)
						);
						return { encryptedSecret: encrypted.ciphertext, encryption: encrypted.metadata };
					})();

		const updated = await this.repository.updateCredential(userId, id, {
			name: validated.name!,
			kind: validated.kind!,
			workspaceId: validated.workspaceId,
			username: validated.username,
			metadata,
			...secretPatch,
			updatedAt: new Date()
		});

		if (!updated) throw new ServiceNotFoundError('Credential not found');
		return redactCredential(updated);
	}

	async delete(userId: string, id: string): Promise<void> {
		const current = await this.repository.getCredential(userId, id);
		if (!current) throw new ServiceNotFoundError('Credential not found');
		await this.assertWorkspaceOwner(userId, current.workspaceId);
		const deleted = await this.repository.deleteCredential(userId, id);
		if (!deleted) throw new ServiceNotFoundError('Credential not found');
	}

	private protectMetadata(
		userId: string,
		credentialId: string,
		kind: CredentialKind,
		metadata: Record<string, unknown>
	): Record<string, unknown> {
		const protectedMetadata = stripSensitiveMetadata(metadata);
		const passphrase = typeof metadata.passphrase === 'string' ? metadata.passphrase : null;

		if (kind === 'ssh_key' && passphrase) {
			const encrypted = this.crypto.encrypt(
				passphrase,
				credentialPassphraseContext(userId, credentialId)
			);
			protectedMetadata[encryptedPassphraseMetadataKey] = {
				ciphertext: encrypted.ciphertext,
				encryption: encrypted.metadata
			};
		}

		return protectedMetadata;
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

	private async assertReferencedHostsRemainInScope(
		userId: string,
		credentialId: string,
		workspaceId: string | null
	): Promise<void> {
		const invalidHost = (await this.repository.listHosts(userId)).find(
			(host) => host.credentialId === credentialId && host.workspaceId !== workspaceId
		);
		if (invalidHost) {
			throw new ServiceValidationError([
				'workspaceId cannot change while hosts in another scope reference this credential'
			]);
		}
	}
}

function validateCredentialInput(
	input: CredentialInput,
	requireSecret: boolean
): {
	name: string | null;
	kind: CredentialKind | null;
	username: string | null;
	workspaceId: string | null;
	secret?: string;
	metadata: Record<string, unknown>;
} {
	const issues: string[] = [];
	const name = asTrimmedString(input.name);
	const kind = input.kind;
	const secret = typeof input.secret === 'string' ? input.secret : undefined;
	const baseMetadata = isRecord(input.metadata) ? input.metadata : {};
	const rdpDomain = asTrimmedString(input.rdpDomain);
	const metadata = { ...baseMetadata };
	if ('rdpDomain' in input) {
		if (rdpDomain) metadata.domain = rdpDomain;
		else delete metadata.domain;
	}

	if (!name) issues.push('name is required');
	if (!credentialKinds.includes(kind as CredentialKind))
		issues.push('kind must be password, ssh_key, or rdp_password');
	if (requireSecret && !secret) issues.push('secret is required');
	if (secret !== undefined && secret.length === 0) issues.push('secret cannot be empty');

	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		name,
		kind: kind as CredentialKind,
		workspaceId: asTrimmedString(input.workspaceId),
		username: asTrimmedString(input.username),
		secret,
		metadata
	};
}

function redactCredential(credential: CredentialRecord): PublicCredentialRecord {
	const {
		encryptedSecret: _encryptedSecret,
		encryption: _encryption,
		metadata,
		...redacted
	} = credential;
	return {
		...redacted,
		metadata: stripSensitiveMetadata(metadata)
	};
}

function stripSensitiveMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(metadata).flatMap(([key, value]) => {
			if (sensitiveMetadataKeys.has(normalizeMetadataKey(key))) return [];
			return [[key, stripSensitiveMetadataValue(value)]];
		})
	);
}

function stripSensitiveMetadataValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripSensitiveMetadataValue);
	if (isRecord(value)) return stripSensitiveMetadata(value);
	return value;
}

function normalizeMetadataKey(key: string): string {
	return key.replace(/[-_\s]/g, '').toLowerCase();
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const credentialService = new CredentialService();

export function credentialSecretContext(
	userId: string,
	credentialId: string
): CredentialEncryptionContext {
	return {
		userId,
		credentialId,
		field: 'secret'
	};
}

export function credentialPassphraseContext(
	userId: string,
	credentialId: string
): CredentialEncryptionContext {
	return {
		userId,
		credentialId,
		field: 'metadata.passphrase'
	};
}
