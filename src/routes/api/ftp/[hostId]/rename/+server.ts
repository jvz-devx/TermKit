import { json, type RequestHandler } from '@sveltejs/kit';
import { renameFtpPath, resolveFtpTarget, validateFtpPath } from '$lib/server/protocols/ftp';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const input = await readJsonObject(event.request);
		const from = validateFtpPath(input.from, 'from');
		const to = validateFtpPath(input.to, 'to');
		const target = await resolveFtpTarget(userId, hostId);

		await renameFtpPath(target, from, to);
		return json({ from, to });
	} catch (error) {
		return serviceJson(error);
	}
};
