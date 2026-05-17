import { json, type RequestHandler } from '@sveltejs/kit';
import { listFtpDirectory, runRecordedFtpAction, validateFtpPath } from '$lib/server/protocols/ftp';
import { serviceJson } from '../../../_helpers';
import { readQueryPath, requireFileTransferContext } from '../../../file-transfer-helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateFtpPath, '/');
		const entries = await runRecordedFtpAction(
			userId,
			hostId,
			'list',
			(target) => listFtpDirectory(target, path),
			{ path }
		);

		return json({ path, entries });
	} catch (error) {
		return serviceJson(error);
	}
};
