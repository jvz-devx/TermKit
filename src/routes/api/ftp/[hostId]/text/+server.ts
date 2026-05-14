import { json, type RequestHandler } from '@sveltejs/kit';
import {
	readFtpTextFile,
	resolveFtpTarget,
	validateFtpPath,
	writeFtpTextFile
} from '$lib/server/protocols/ftp';
import { ServiceValidationError } from '$lib/server/services/errors';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const hostId = requireParam(event.params.hostId, 'hostId');
		const path = validateFtpPath(event.url.searchParams.get('path'));
		const target = await resolveFtpTarget(userId, hostId);
		const text = await readFtpTextFile(target, path);

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
		const path = validateFtpPath(input.path);
		if (typeof input.text !== 'string') {
			throw new ServiceValidationError(['text is required']);
		}

		const target = await resolveFtpTarget(userId, hostId);
		await writeFtpTextFile(target, path, input.text);

		return json({ path, size: Buffer.byteLength(input.text, 'utf8') });
	} catch (error) {
		return serviceJson(error);
	}
};
