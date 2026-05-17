import type { RequestHandler } from '@sveltejs/kit';
import { openRecordedFtpDownload, validateFtpPath } from '$lib/server/protocols/ftp';
import { serviceJson } from '../../../_helpers';
import {
	downloadResponse,
	readQueryPath,
	requireFileTransferContext
} from '../../../file-transfer-helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateFtpPath);
		const download = await openRecordedFtpDownload(userId, hostId, path);

		download.done.catch(() => undefined);
		return downloadResponse(path, download.body);
	} catch (error) {
		return serviceJson(error);
	}
};
