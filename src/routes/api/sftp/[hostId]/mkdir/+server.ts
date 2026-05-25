import { json, type RequestHandler } from '@sveltejs/kit';
import {
	createSftpDirectory,
	resolveSftpTarget,
	validateSftpPath
} from '$lib/server/protocols/sftp';
import { serviceJson } from '../../../_helpers';
import {
	readJsonPath,
	requireFileTransferContext,
	runRecordedFileTransferAction
} from '../../../file-transfer-helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = await readJsonPath(event, validateSftpPath);
		const target = await resolveSftpTarget(userId, hostId);

		await runRecordedFileTransferAction(
			{ userId, hostId, protocol: 'sftp', action: 'mkdir', path },
			() => createSftpDirectory(target, path)
		);
		return json({ path }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
