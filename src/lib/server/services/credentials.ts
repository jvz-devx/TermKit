import { randomUUID } from 'node:crypto';
import { AesGcmCredentialCrypto } from './crypto';
import { ServiceNotFoundError, ServiceValidationError } from './errors';
import { termixRepository } from './repository';
import type {
	CredentialCrypto,
	CredentialKind,
	CredentialRecord,
	CredentialRepository
} from './types';
import { credentialKinds } from './types';

export interface CredentialInput {
	name?: unknown;
	kind?: unknown;
	username?: unknown;
	secret?: unknown;
	metadata?: unknown;
}

export class CredentialService {
	constructor(
		private readonly repository: CredentialRepository = termixRepository,
		private readonly crypto: CredentialCrypto = new AesGcmCredentialCrypto()
	) {}

	async list(userId: string): Promise<Array<Omit<CredentialRecord, 'encryptedSecret'>>> {
		return (await this.repository.listCredentials(userId)).map(redactCredential);
	}

	async get(userId: string, id: string): Promise<Omit<CredentialRecord, 'encryptedSecret'>> {
		const credential = await this.repository.getCredential(userId, id);
		if (!credential) throw new ServiceNotFoundError('Credential not found');
		return redactCredential(credential);
	}

	async create(
		userId: string,
		input: CredentialInput
	): Promise<Omit<CredentialRecord, 'encryptedSecret'>> {
		const now = new Date();
		const validated = validateCredentialInput(input, true);
		const encrypted = this.crypto.encrypt(validated.secret!);
		const credential = await this.repository.createCredential({
			id: randomUUID(),
			userId,
			name: validated.name!,
			kind: validated.kind!,
			username: validated.username,
			encryptedSecret: encrypted.ciphertext,
			encryption: encrypted.metadata,
			metadata: validated.metadata,
			createdAt: now,
			updatedAt: now
		});

		return redactCredential(credential);
	}

	async update(
		userId: string,
		id: string,
		input: CredentialInput
	): Promise<Omit<CredentialRecord, 'encryptedSecret'>> {
		const current = await this.repository.getCredential(userId, id);
		if (!current) throw new ServiceNotFoundError('Credential not found');

		const validated = validateCredentialInput({ ...current, ...input }, false);
		const secretPatch =
			validated.secret === undefined
				? {}
				: (() => {
						const encrypted = this.crypto.encrypt(validated.secret);
						return { encryptedSecret: encrypted.ciphertext, encryption: encrypted.metadata };
					})();

		const updated = await this.repository.updateCredential(userId, id, {
			name: validated.name!,
			kind: validated.kind!,
			username: validated.username,
			metadata: validated.metadata,
			...secretPatch,
			updatedAt: new Date()
		});

		if (!updated) throw new ServiceNotFoundError('Credential not found');
		return redactCredential(updated);
	}

	async delete(userId: string, id: string): Promise<void> {
		const deleted = await this.repository.deleteCredential(userId, id);
		if (!deleted) throw new ServiceNotFoundError('Credential not found');
	}
}

function validateCredentialInput(
	input: CredentialInput,
	requireSecret: boolean
): {
	name: string | null;
	kind: CredentialKind | null;
	username: string | null;
	secret?: string;
	metadata: Record<string, unknown>;
} {
	const issues: string[] = [];
	const name = asTrimmedString(input.name);
	const kind = input.kind;
	const secret = typeof input.secret === 'string' ? input.secret : undefined;

	if (!name) issues.push('name is required');
	if (!credentialKinds.includes(kind as CredentialKind))
		issues.push('kind must be password or ssh_key');
	if (requireSecret && !secret) issues.push('secret is required');
	if (secret !== undefined && secret.length === 0) issues.push('secret cannot be empty');

	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		name,
		kind: kind as CredentialKind,
		username: asTrimmedString(input.username),
		secret,
		metadata: isRecord(input.metadata) ? input.metadata : {}
	};
}

function redactCredential(credential: CredentialRecord): Omit<CredentialRecord, 'encryptedSecret'> {
	const { encryptedSecret: _encryptedSecret, ...redacted } = credential;
	return redacted;
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const credentialService = new CredentialService();
