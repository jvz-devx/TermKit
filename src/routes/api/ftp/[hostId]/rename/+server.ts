import { json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { renameFtpPath, runRecordedFtpAction, validateFtpPath } from '$lib/server/protocols/ftp';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export async function _renameFtpRouteAction(
	event: RequestEvent,
	action: 'rename' | 'move' = 'rename'
) {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const input = await readJsonObject(event.request);
		const from = validateFtpPath(input.from, 'from');
		const to = validateFtpPath(input.to, 'to');

		await runRecordedFtpAction(
			userId,
			hostId,
			action === 'move' ? 'move' : 'rename',
			(target) => renameFtpPath(target, from, to),
			{ path: from }
		);
		return json({ from, to });
	} catch (error) {
		return serviceJson(error);
	}
}

export const POST: RequestHandler = (event) => _renameFtpRouteAction(event);
