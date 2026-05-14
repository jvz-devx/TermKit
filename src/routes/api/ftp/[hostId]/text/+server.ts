import { json, type RequestHandler } from '@sveltejs/kit';
import {
	readFtpTextFile,
	runRecordedFtpAction,
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
		const text = await runRecordedFtpAction(
			userId,
			hostId,
			'read_text',
			(target) => readFtpTextFile(target, path),
			{ path }
		);

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

		await runRecordedFtpAction(
			userId,
			hostId,
			'write_text',
			(target) => writeFtpTextFile(target, path, input.text as string),
			{ path }
		);

		return json({ path, size: Buffer.byteLength(input.text, 'utf8') });
	} catch (error) {
		return serviceJson(error);
	}
};
