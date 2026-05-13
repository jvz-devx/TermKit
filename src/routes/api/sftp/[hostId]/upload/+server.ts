import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveSftpTarget, validateSftpPath, writeSftpFile } from '$lib/server/protocols/sftp';
import { ServiceValidationError } from '$lib/server/services/errors';
import { requireParam, requireUser, serviceJson } from '../../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateSftpPath(event.url.searchParams.get('path'));
		const file = (await event.request.formData()).get('file');

		if (!(file instanceof File)) {
			throw new ServiceValidationError(['file is required']);
		}

		const target = await resolveSftpTarget(userId, hostId);
		const data = Buffer.from(await file.arrayBuffer());
		await writeSftpFile(target, path, data);

		return json({ path, size: data.byteLength }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
