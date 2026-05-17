import { json, type RequestHandler } from '@sveltejs/kit';
import { renameSftpPath, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { serviceJson } from '../../../_helpers';
import { readJsonRename, requireFileTransferContext } from '../../../file-transfer-helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const { from, to } = await readJsonRename(event, validateSftpPath);
		const target = await resolveSftpTarget(userId, hostId);

		await renameSftpPath(target, from, to);
		return json({ from, to });
	} catch (error) {
		return serviceJson(error);
	}
};
