import { json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { renameFtpPath, runRecordedFtpAction, validateFtpPath } from '$lib/server/protocols/ftp';
import { serviceJson } from '../../../_helpers';
import { readJsonRename, requireFileTransferContext } from '../../../file-transfer-helpers';

export async function _renameFtpRouteAction(
	event: RequestEvent,
	action: 'rename' | 'move' = 'rename'
) {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const { from, to } = await readJsonRename(event, validateFtpPath);

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
