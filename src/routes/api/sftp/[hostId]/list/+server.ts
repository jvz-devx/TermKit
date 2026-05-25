import { json, type RequestHandler } from '@sveltejs/kit';
import { listSftpDirectory, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { serviceJson } from '../../../_helpers';
import {
	readQueryPath,
	requireFileTransferContext,
	runRecordedFileTransferAction
} from '../../../file-transfer-helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateSftpPath, '/');
		const target = await resolveSftpTarget(userId, hostId);
		const entries = await runRecordedFileTransferAction(
			{ userId, hostId, protocol: 'sftp', action: 'list', path },
			() => listSftpDirectory(target, path)
		);

		return json({ path, entries });
	} catch (error) {
		return serviceJson(error);
	}
};
