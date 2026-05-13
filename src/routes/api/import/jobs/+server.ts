import { json, type RequestHandler } from '@sveltejs/kit';
import { ServiceValidationError } from '$lib/server/services/errors';
import { importService } from '$lib/server/import/service';
import { requireUser, serviceJson } from '../../_helpers';

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
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) {
		throw new ServiceValidationError(['file is required']);
	}

	return {
		fileName: file.name,
		contentType: file.type,
		bytes: await file.arrayBuffer()
	};
}
