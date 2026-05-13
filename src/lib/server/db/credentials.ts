import { and, eq } from 'drizzle-orm';
import { db } from './index';
import { credentialKind, credentials } from './schema';
import {
	decryptCredentialSecret,
	encryptCredentialSecret,
	type CredentialEncryptionMetadata
} from '$lib/server/crypto/credentials';

type CredentialKind = (typeof credentialKind.enumValues)[number];

export type CreateCredentialInput = {
	userId: string;
	name: string;
	kind: CredentialKind;
	username?: string | null;
	secret: string;
	metadata?: Record<string, unknown>;
};

export type StoredCredential = typeof credentials.$inferSelect;

export async function createCredential(input: CreateCredentialInput): Promise<StoredCredential> {
	const encrypted = encryptCredentialSecret(input.secret);
	const [credential] = await db
		.insert(credentials)
		.values({
			userId: input.userId,
			name: input.name,
			kind: input.kind,
			username: input.username,
			encryptedSecret: encrypted.ciphertext,
			encryptionMetadata: encrypted.metadata,
			metadata: input.metadata ?? {}
		})
		.returning();

	if (!credential) {
		throw new Error('Could not create credential');
	}

	return credential;
}

export async function getCredentialForUser(
	userId: string,
	credentialId: string
): Promise<StoredCredential | null> {
	const [credential] = await db
		.select()
		.from(credentials)
		.where(and(eq(credentials.id, credentialId), eq(credentials.userId, userId)))
		.limit(1);

	return credential ?? null;
}

export async function decryptStoredCredentialSecret(credential: StoredCredential): Promise<string> {
	return decryptCredentialSecret({
		ciphertext: credential.encryptedSecret,
		metadata: credential.encryptionMetadata as CredentialEncryptionMetadata
	});
}
