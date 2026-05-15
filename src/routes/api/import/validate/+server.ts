import { json, type RequestHandler } from '@sveltejs/kit';
import { importService } from '$lib/server/import/service';
import {
	IMPORT_UPLOAD_MAX_BYTES,
	getRequiredFormFile,
	readMultipartFormData,
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
	const form = await readMultipartFormData(request, IMPORT_UPLOAD_MAX_BYTES);
	const file = getRequiredFormFile(form, 'file', IMPORT_UPLOAD_MAX_BYTES);
	const sourceSecret = form?.get('sourceSecret');

	return {
		fileName: file.name,
		contentType: file.type,
		bytes: await file.arrayBuffer(),
		sourceSecret: typeof sourceSecret === 'string' ? sourceSecret.trim() || undefined : undefined
	};
}
