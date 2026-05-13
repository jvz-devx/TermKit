import { json, type RequestHandler } from '@sveltejs/kit';
import {
	readSftpTextFile,
	resolveSftpTarget,
	validateSftpPath,
	writeSftpTextFile
} from '$lib/server/protocols/sftp';
import { ServiceValidationError } from '$lib/server/services/errors';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateSftpPath(event.url.searchParams.get('path'));
		const target = await resolveSftpTarget(userId, hostId);
		const text = await readSftpTextFile(target, path);

		return json({ path, text });
	} catch (error) {
		return serviceJson(error);
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const input = await readJsonObject(event.request);
		const path = validateSftpPath(input.path);
		if (typeof input.text !== 'string') {
			throw new ServiceValidationError(['text is required']);
		}

		const target = await resolveSftpTarget(userId, hostId);
		await writeSftpTextFile(target, path, input.text);

		return json({ path, size: Buffer.byteLength(input.text, 'utf8') });
	} catch (error) {
		return serviceJson(error);
	}
};
