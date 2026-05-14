import posixPath from 'node:path/posix';
import type { RequestHandler } from '@sveltejs/kit';
import { openRecordedFtpDownload, validateFtpPath } from '$lib/server/protocols/ftp';
import { requireParam, requireUser, serviceJson } from '../../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateFtpPath(event.url.searchParams.get('path'));
		const download = await openRecordedFtpDownload(userId, hostId, path);
		const filename = encodeURIComponent(posixPath.basename(path));

		download.done.catch(() => undefined);
		return new Response(download.body, {
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename*=UTF-8''${filename}`
			}
		});
	} catch (error) {
		return serviceJson(error);
	}
};
