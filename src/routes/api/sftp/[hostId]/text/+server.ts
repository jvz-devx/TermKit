import { json, type RequestHandler } from '@sveltejs/kit';
import {
	readSftpTextFile,
	resolveSftpTarget,
	validateSftpPath,
	writeSftpTextFile
} from '$lib/server/protocols/sftp';
import { ServiceValidationError } from '$lib/server/services/errors';
import { readJsonObject, serviceJson } from '../../../_helpers';
import {
	readQueryPath,
	requireFileTransferContext,
	runRecordedFileTransferAction
} from '../../../file-transfer-helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const path = readQueryPath(event, validateSftpPath);
		const target = await resolveSftpTarget(userId, hostId);
		const text = await runRecordedFileTransferAction(
			{ userId, hostId, protocol: 'sftp', action: 'read_text', path },
			() => readSftpTextFile(target, path)
		);

		return json({ path, text });
	} catch (error) {
		return serviceJson(error);
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		const { userId, hostId } = requireFileTransferContext(event);
		const input = await readJsonObject(event.request);
		const path = validateSftpPath(input.path);
		if (typeof input.text !== 'string') {
			throw new ServiceValidationError(['text is required']);
		}
		const text = input.text;

		const target = await resolveSftpTarget(userId, hostId);
		await runRecordedFileTransferAction(
			{ userId, hostId, protocol: 'sftp', action: 'write_text', path },
			() => writeSftpTextFile(target, path, text)
		);

		return json({ path, size: Buffer.byteLength(text, 'utf8') });
	} catch (error) {
		return serviceJson(error);
	}
};
