import { command, query } from '$app/server';
import { credentialService } from '$lib/server/services/credentials';
import { hostService } from '$lib/server/services/hosts';
import {
	getSshHostKeyTrustSummary,
	enrollSshHostKey as enrollSshHostKeyForUser
} from '$lib/server/protocols/ssh-host-key-enrollment';
import { ServiceValidationError } from '$lib/server/services/errors';
import {
	hostGroupsByHostId,
	listHostGroupsForUser,
	setHostGroupIdsForHost
} from '$lib/server/services/host-groups';
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
	const groupsByHostId = await hostGroupsByHostId(userId);
	const credentialNames = new Map(
		credentials.map((credential) => [credential.id, credential.name])
	);

	const summaries = await Promise.all(
		hosts.map(async (host): Promise<HostSummary> => {
			const hostKeyTrust =
				host.protocol === 'ssh' ? await safeSshHostKeyTrustSummary(userId, host.id) : null;
			return toHostSummary(
				host,
				credentialNames.get(host.credentialId ?? ''),
				hostKeyTrust,
				groupsByHostId.get(host.id) ?? []
			);
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
	const groupIds = normalizeGroupIds(input.groupIds);
	const assignedGroups =
		groupIds === undefined ? [] : await validateGroupIdsForUser(userId, groupIds);
	const host =
		typeof input.id === 'string' && input.id
			? await hostService.update(userId, input.id, normalized)
			: await hostService.create(userId, normalized);
	if (groupIds !== undefined) {
		await setHostGroupIdsForHost(userId, host.id, groupIds);
	}
	const credentialName = await credentialNameForHost(userId, host.credentialId);

	void listHosts().refresh();
	void listCredentials().refresh();

	return toHostSummary(host, credentialName, null, assignedGroups);
});

function normalizeGroupIds(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new ServiceValidationError(['groupIds must be an array']);
	return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))];
}

async function validateGroupIdsForUser(userId: string, groupIds: string[]) {
	if (groupIds.length === 0) return [];
	const groups = await listHostGroupsForUser(userId);
	const groupsById = new Map(groups.map((group) => [group.id, group]));
	const assignedGroups = [];
	for (const groupId of groupIds) {
		const group = groupsById.get(groupId);
		if (!group) throw new ServiceValidationError(['groupIds must reference existing groups']);
		assignedGroups.push(group);
	}
	return assignedGroups;
}

async function credentialNameForHost(
	userId: string,
	credentialId: string | null
): Promise<string | null> {
	if (!credentialId) return null;
	const credentials = await credentialService.list(userId);
	return credentials.find((credential) => credential.id === credentialId)?.name ?? null;
}

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
