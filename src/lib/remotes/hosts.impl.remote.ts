import { command, query } from '$app/server';
import { credentialService } from '$lib/server/services/credentials';
import { hostService } from '$lib/server/services/hosts';
import {
	getSshHostKeyTrustSummary,
	enrollSshHostKey as enrollSshHostKeyForUser
} from '$lib/server/protocols/ssh-host-key-enrollment';
import { ServiceValidationError } from '$lib/server/services/errors';
import { listCredentials } from './credentials.impl.remote';
import {
	requireRemoteUser,
	safeSshHostKeyTrustSummary,
	toHostSummary,
	type HostMutationInput,
	type HostSummary,
	type SshHostKeyTrustSummary
} from './termix-core.shared';

export type { HostMutationInput, HostSummary, SshHostKeyTrustSummary } from './termix-core.shared';

export const listHosts = query(async () => {
	const userId = requireRemoteUser();
	const [hosts, credentials] = await Promise.all([
		hostService.list(userId),
		credentialService.list(userId)
	]);
	const credentialNames = new Map(
		credentials.map((credential) => [credential.id, credential.name])
	);

	const summaries = await Promise.all(
		hosts.map(async (host): Promise<HostSummary> => {
			const hostKeyTrust =
				host.protocol === 'ssh' ? await safeSshHostKeyTrustSummary(userId, host.id) : null;
			return toHostSummary(host, credentialNames.get(host.credentialId ?? ''), hostKeyTrust);
		})
	);

	return summaries.sort((left, right) => left.name.localeCompare(right.name));
});

export const saveHost = command<HostMutationInput, HostSummary>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const tags =
		typeof input.tags === 'string'
			? input.tags
					.split(',')
					.map((tag) => tag.trim())
					.filter(Boolean)
			: input.tags;
	const normalized = {
		...input,
		tags,
		credentialId: input.credentialId === 'none' ? null : input.credentialId
	};
	const host =
		typeof input.id === 'string' && input.id
			? await hostService.update(userId, input.id, normalized)
			: await hostService.create(userId, normalized);

	void listHosts().refresh();
	void listCredentials().refresh();

	return {
		...toHostSummary(host, null),
		credentialName: null
	};
});

export const inspectSshHostKeyTrust = command<unknown, SshHostKeyTrustSummary>(
	'unchecked',
	async (hostId) => {
		const userId = requireRemoteUser();
		if (typeof hostId !== 'string' || !hostId) {
			throw new ServiceValidationError(['hostId is required']);
		}
		return getSshHostKeyTrustSummary(userId, hostId);
	}
);

export const enrollSshHostKey = command<unknown, SshHostKeyTrustSummary>(
	'unchecked',
	async (hostId) => {
		const userId = requireRemoteUser();
		if (typeof hostId !== 'string' || !hostId) {
			throw new ServiceValidationError(['hostId is required']);
		}
		const trust = await enrollSshHostKeyForUser(userId, hostId);
		void listHosts().refresh();
		return trust;
	}
);

export const deleteHost = command<string, void>('unchecked', async (id) => {
	const userId = requireRemoteUser();
	if (typeof id !== 'string' || !id) throw new ServiceValidationError(['id is required']);
	await hostService.delete(userId, id);
	void listHosts().refresh();
	void listCredentials().refresh();
});
