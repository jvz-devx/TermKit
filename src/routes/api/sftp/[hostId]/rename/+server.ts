import { json, type RequestHandler } from '@sveltejs/kit';
import { renameSftpPath, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const input = await readJsonObject(event.request);
		const from = validateSftpPath(input.from, 'from');
		const to = validateSftpPath(input.to, 'to');
		const target = await resolveSftpTarget(userId, hostId);

		await renameSftpPath(target, from, to);
		return json({ from, to });
	} catch (error) {
		return serviceJson(error);
	}
};
