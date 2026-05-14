import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteFtpPath, runRecordedFtpAction, validateFtpPath } from '$lib/server/protocols/ftp';
import { requireParam, requireUser, serviceJson } from '../../../_helpers';

export const DELETE: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateFtpPath(event.url.searchParams.get('path'));

		await runRecordedFtpAction(userId, hostId, 'delete', (target) => deleteFtpPath(target, path), {
			path
		});
		return json({ path });
	} catch (error) {
		return serviceJson(error);
	}
};
