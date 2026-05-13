import { json, type RequestHandler } from '@sveltejs/kit';
import { importService } from '$lib/server/import/service';
import {
	IMPORT_UPLOAD_MAX_BYTES,
	readRequiredFormFile,
	requireUser,
	serviceJson
} from '../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		return json({ jobs: await importService.listJobs(userId) });
	} catch (error) {
		return serviceJson(error);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const upload = await readImportUpload(event.request);
		const result = await importService.import(userId, upload);
		return json(result, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};

async function readImportUpload(request: Request) {
	const file = await readRequiredFormFile(request, 'file', IMPORT_UPLOAD_MAX_BYTES);

	return {
		fileName: file.name,
		contentType: file.type,
		bytes: await file.arrayBuffer()
	};
}
