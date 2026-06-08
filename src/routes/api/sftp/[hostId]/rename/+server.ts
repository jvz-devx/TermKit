import { json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { renameSftpPath, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { serviceJson } from '../../../_helpers';
import {
	readJsonRename,
	requireFileTransferContext,
	runRecordedFileTransferAction
} from '../../../file-transfer-helpers';

export async function _renameSftpRouteAction(
	event: RequestEvent,
	action: 'rename' | 'move' = 'rename'
) {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const { from, to } = await readJsonRename(event, validateSftpPath);
		const target = await resolveSftpTarget(userId, hostId);

		await runRecordedFileTransferAction(
			{ userId, hostId, protocol: 'sftp', action, path: from },
			() => renameSftpPath(target, from, to)
		);
		return json({ from, to });
	} catch (error) {
		return serviceJson(error);
	}
}

export const POST: RequestHandler = (event) => _renameSftpRouteAction(event);
