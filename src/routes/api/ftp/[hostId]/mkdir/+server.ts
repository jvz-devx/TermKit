import { json, type RequestHandler } from '@sveltejs/kit';
import {
	createFtpDirectory,
	runRecordedFtpAction,
	validateFtpPath
} from '$lib/server/protocols/ftp';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const input = await readJsonObject(event.request);
		const path = validateFtpPath(input.path);

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
