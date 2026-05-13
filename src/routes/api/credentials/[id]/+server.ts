import { json, type RequestHandler } from '@sveltejs/kit';
import { credentialService } from '$lib/server/services/credentials';
import { readJsonObject, requireParam, requireUser, serviceJson } from '../../_helpers';

export const GET: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const id = requireParam(event.params.id, 'id');
		return json({ credential: await credentialService.get(userId, id) });
	} catch (error) {
		return serviceJson(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const id = requireParam(event.params.id, 'id');
		const input = await readJsonObject(event.request);
		return json({ credential: await credentialService.update(userId, id, input) });
	} catch (error) {
		return serviceJson(error);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const id = requireParam(event.params.id, 'id');
		await credentialService.delete(userId, id);
		return new Response(null, { status: 204 });
	} catch (error) {
		return serviceJson(error);
	}
};
