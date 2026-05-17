import { command, query } from '$app/server';
import { credentialService } from '$lib/server/services/credentials';
import { hostService } from '$lib/server/services/hosts';
import { ServiceValidationError } from '$lib/server/services/errors';
import { listHosts } from './hosts.impl.remote';
import {
	requireRemoteUser,
	type CredentialMutationInput,
	type CredentialSummary
} from './termix-core.shared';

export type { CredentialMutationInput, CredentialSummary } from './termix-core.shared';

export const listCredentials = query(async () => {
	const userId = requireRemoteUser();
	const [credentials, hosts] = await Promise.all([
		credentialService.list(userId),
		hostService.list(userId)
	]);

	return credentials
		.map(
			(credential): CredentialSummary => ({
				id: credential.id,
				name: credential.name,
				kind: credential.kind,
				username: credential.username,
				usedBy: hosts.filter((host) => host.credentialId === credential.id).length,
				createdAt: credential.createdAt.toISOString(),
				updatedAt: credential.updatedAt.toISOString()
			})
		)
		.sort((left, right) => left.name.localeCompare(right.name));
});

export const saveCredential = command<CredentialMutationInput, CredentialSummary>(
	'unchecked',
	async (input) => {
		const userId = requireRemoteUser();
		const credential =
			typeof input.id === 'string' && input.id
				? await credentialService.update(userId, input.id, input)
				: await credentialService.create(userId, input);

		void listCredentials().refresh();

		return {
			id: credential.id,
			name: credential.name,
			kind: credential.kind,
			username: credential.username,
			usedBy: 0,
			createdAt: credential.createdAt.toISOString(),
			updatedAt: credential.updatedAt.toISOString()
		};
	}
);

export const deleteCredential = command<string, void>('unchecked', async (id) => {
	const userId = requireRemoteUser();
	if (typeof id !== 'string' || !id) throw new ServiceValidationError(['id is required']);
	await credentialService.delete(userId, id);
	void listCredentials().refresh();
	void listHosts().refresh();
});
