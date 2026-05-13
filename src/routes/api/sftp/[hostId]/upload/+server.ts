import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveSftpTarget, validateSftpPath, writeSftpFile } from '$lib/server/protocols/sftp';
import {
	readRequiredFormFile,
	requireParam,
	requireUser,
	serviceJson,
	SFTP_UPLOAD_MAX_BYTES
} from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateSftpPath(event.url.searchParams.get('path'));
		const file = await readRequiredFormFile(event.request, 'file', SFTP_UPLOAD_MAX_BYTES);

		const target = await resolveSftpTarget(userId, hostId);
		const data = Buffer.from(await file.arrayBuffer());
		await writeSftpFile(target, path, data);

		return json({ path, size: data.byteLength }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
