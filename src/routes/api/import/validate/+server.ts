import { json, type RequestHandler } from '@sveltejs/kit';
import { importService } from '$lib/server/import/service';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import {
	IMPORT_UPLOAD_MAX_BYTES,
	assertContentLength,
	requireUser,
	serviceJson
} from '../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const upload = await readImportUpload(event.request);
		const result = await importService.validate(userId, upload);
		return json(result);
	} catch (error) {
		return serviceJson(error);
	}
};

async function readImportUpload(request: Request) {
	assertContentLength(request, IMPORT_UPLOAD_MAX_BYTES);
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) {
		throw new ServiceValidationError(['file is required']);
	}
	if (file.size > IMPORT_UPLOAD_MAX_BYTES) {
		throw new ServicePayloadTooLargeError('file exceeds the 10 MiB upload limit');
	}
	const sourceSecret = form?.get('sourceSecret');

	return {
		fileName: file.name,
		contentType: file.type,
		bytes: await file.arrayBuffer(),
		sourceSecret: typeof sourceSecret === 'string' ? sourceSecret.trim() || undefined : undefined
	};
}
