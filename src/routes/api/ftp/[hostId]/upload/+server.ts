import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveFtpTarget, validateFtpPath, writeFtpFile } from '$lib/server/protocols/ftp';
import { readRequiredFormFile, requireParam, requireUser, serviceJson } from '../../../_helpers';

const FTP_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateFtpPath(event.url.searchParams.get('path'));
		const file = await readRequiredFormFile(event.request, 'file', FTP_UPLOAD_MAX_BYTES);

		const target = await resolveFtpTarget(userId, hostId);
		const data = Buffer.from(await file.arrayBuffer());
		await writeFtpFile(target, path, data);

		return json({ path, size: data.byteLength }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
