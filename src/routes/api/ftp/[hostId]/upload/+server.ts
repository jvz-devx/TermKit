import { json, type RequestHandler } from '@sveltejs/kit';
import {
	maxFtpUploadBytes,
	runRecordedFtpAction,
	validateFtpPath,
	writeFtpFile
} from '$lib/server/protocols/ftp';
import { readRequiredFormFile, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateFtpPath(event.url.searchParams.get('path'));
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
