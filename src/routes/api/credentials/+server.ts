import { json, type RequestHandler } from '@sveltejs/kit';
import { credentialService } from '$lib/server/services/credentials';
import { readJsonObject, requireUser, serviceJson } from '../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		return json({ credentials: await credentialService.list(userId) });
	} catch (error) {
		return serviceJson(error);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const input = await readJsonObject(event.request);
		const credential = await credentialService.create(userId, input);
		return json({ credential }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
