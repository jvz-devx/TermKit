import { json, type RequestHandler } from '@sveltejs/kit';
import {
	createSftpDirectory,
	resolveSftpTarget,
	validateSftpPath
} from '$lib/server/protocols/sftp';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const input = await readJsonObject(event.request);
		const path = validateSftpPath(input.path);
		const target = await resolveSftpTarget(userId, hostId);

		await createSftpDirectory(target, path);
		return json({ path }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
