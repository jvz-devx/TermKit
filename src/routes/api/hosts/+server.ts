import { json, type RequestHandler } from '@sveltejs/kit';
import { hostService } from '$lib/server/services/hosts';
import { readJsonObject, requireUser, serviceJson } from '../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		return json({ hosts: await hostService.list(userId) });
	} catch (error) {
		return serviceJson(error);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const input = await readJsonObject(event.request);
		const host = await hostService.create(userId, input);
		return json({ host }, { status: 201 });
	} catch (error) {
		return serviceJson(error);
	}
};
