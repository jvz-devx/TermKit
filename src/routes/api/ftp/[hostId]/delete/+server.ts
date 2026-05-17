import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteFtpPath, runRecordedFtpAction, validateFtpPath } from '$lib/server/protocols/ftp';
import { serviceJson } from '../../../_helpers';
import { readQueryPath, requireFileTransferContext } from '../../../file-transfer-helpers';

export const DELETE: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateFtpPath);

		await runRecordedFtpAction(userId, hostId, 'delete', (target) => deleteFtpPath(target, path), {
			path
		});
		return json({ path });
	} catch (error) {
		return serviceJson(error);
	}
};
