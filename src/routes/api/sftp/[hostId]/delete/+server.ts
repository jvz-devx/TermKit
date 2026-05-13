import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteSftpPath, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { requireParam, requireUser, serviceJson } from '../../../_helpers';

export const DELETE: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateSftpPath(event.url.searchParams.get('path'));
		const target = await resolveSftpTarget(userId, hostId);

		await deleteSftpPath(target, path);
		return json({ path });
	} catch (error) {
		return serviceJson(error);
	}
};
