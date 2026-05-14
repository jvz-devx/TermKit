import { json, type RequestHandler } from '@sveltejs/kit';
import { createFtpDirectory, resolveFtpTarget, validateFtpPath } from '$lib/server/protocols/ftp';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const input = await readJsonObject(event.request);
		const path = validateFtpPath(input.path);
		const target = await resolveFtpTarget(userId, hostId);

		await createFtpDirectory(target, path);
		return json({ path }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
