import { json, type RequestHandler } from '@sveltejs/kit';
import {
	maxFtpUploadBytes,
	runRecordedFtpAction,
	validateFtpPath,
	writeFtpFile
} from '$lib/server/protocols/ftp';
import { readRequiredFormFile, serviceJson } from '../../../_helpers';
import { readQueryPath, requireFileTransferContext } from '../../../file-transfer-helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateFtpPath);
		const file = await readRequiredFormFile(event.request, 'file', maxFtpUploadBytes);

		const data = Buffer.from(await file.arrayBuffer());
		await runRecordedFtpAction(
			userId,
			hostId,
			'upload',
			(target) => writeFtpFile(target, path, data),
			{ path }
		);

		return json({ path, size: data.byteLength }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
