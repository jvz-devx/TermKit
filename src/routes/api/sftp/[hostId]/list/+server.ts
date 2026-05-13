import { json, type RequestHandler } from '@sveltejs/kit';
import { listSftpDirectory, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { requireParam, requireUser, serviceJson } from '../../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateSftpPath(event.url.searchParams.get('path') ?? '/');
		const target = await resolveSftpTarget(userId, hostId);
		const entries = await listSftpDirectory(target, path);

		return json({ path, entries });
	} catch (error) {
		return serviceJson(error);
	}
};
