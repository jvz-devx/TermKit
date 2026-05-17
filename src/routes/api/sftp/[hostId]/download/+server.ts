import type { RequestHandler } from '@sveltejs/kit';
import { readSftpFile, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { serviceJson } from '../../../_helpers';
import {
	downloadResponse,
	readQueryPath,
	requireFileTransferContext
} from '../../../file-transfer-helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateSftpPath);
		const target = await resolveSftpTarget(userId, hostId);
		const data = await readSftpFile(target, path);

		return downloadResponse(path, new Uint8Array(data), data.byteLength);
	} catch (error) {
		return serviceJson(error);
	}
};
