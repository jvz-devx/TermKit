import { json, type RequestHandler } from '@sveltejs/kit';
import { listFtpDirectory, resolveFtpTarget, validateFtpPath } from '$lib/server/protocols/ftp';
import { requireParam, requireUser, serviceJson } from '../../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateFtpPath(event.url.searchParams.get('path') ?? '/');
		const target = await resolveFtpTarget(userId, hostId);
		const entries = await listFtpDirectory(target, path);

		return json({ path, entries });
	} catch (error) {
		return serviceJson(error);
	}
};
