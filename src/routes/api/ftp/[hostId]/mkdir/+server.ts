import { json, type RequestHandler } from '@sveltejs/kit';
import {
	createFtpDirectory,
	runRecordedFtpAction,
	validateFtpPath
} from '$lib/server/protocols/ftp';
import { serviceJson } from '../../../_helpers';
import { readJsonPath, requireFileTransferContext } from '../../../file-transfer-helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = await readJsonPath(event, validateFtpPath);

		await runRecordedFtpAction(
			userId,
			hostId,
			'mkdir',
			(target) => createFtpDirectory(target, path),
			{ path }
		);
		return json({ path }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
