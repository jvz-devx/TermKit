import posixPath from 'node:path/posix';
import type { RequestHandler } from '@sveltejs/kit';
import { readSftpFile, resolveSftpTarget, validateSftpPath } from '$lib/server/protocols/sftp';
import { requireParam, requireUser, serviceJson } from '../../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateSftpPath(event.url.searchParams.get('path'));
		const target = await resolveSftpTarget(userId, hostId);
		const data = await readSftpFile(target, path);
		const filename = encodeURIComponent(posixPath.basename(path));

		return new Response(new Uint8Array(data), {
			headers: {
				'content-type': 'application/octet-stream',
				'content-length': String(data.byteLength),
				'content-disposition': `attachment; filename*=UTF-8''${filename}`
			}
		});
	} catch (error) {
		return serviceJson(error);
	}
};
