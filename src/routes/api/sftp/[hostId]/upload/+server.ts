import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveSftpTarget, validateSftpPath, writeSftpFile } from '$lib/server/protocols/sftp';
import { readRequiredFormFile, serviceJson, SFTP_UPLOAD_MAX_BYTES } from '../../../_helpers';
import {
	readQueryPath,
	requireFileTransferContext,
	runRecordedFileTransferAction
} from '../../../file-transfer-helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateSftpPath);
		const file = await readRequiredFormFile(event.request, 'file', SFTP_UPLOAD_MAX_BYTES);

		const target = await resolveSftpTarget(userId, hostId);
		const data = Buffer.from(await file.arrayBuffer());
		await runRecordedFileTransferAction(
			{ userId, hostId, protocol: 'sftp', action: 'upload', path },
			() => writeSftpFile(target, path, data)
		);

		return json({ path, size: data.byteLength }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
