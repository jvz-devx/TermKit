import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteSftpPath, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { serviceJson } from '../../../_helpers';
import { readQueryPath, requireFileTransferContext } from '../../../file-transfer-helpers';

export const DELETE: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateSftpPath);
		const target = await resolveSftpTarget(userId, hostId);

		await deleteSftpPath(target, path);
		return json({ path });
	} catch (error) {
		return serviceJson(error);
	}
};
