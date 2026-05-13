import { json, type RequestHandler } from '@sveltejs/kit';
import { sessionTicketService } from '$lib/server/services/session-tickets';
import { readJsonObject, requireUser, serviceJson } from '../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const input = await readJsonObject(event.request);
		const created = await sessionTicketService.create(userId, input);
		return json(
			{
				ticket: created.ticket,
				expiresAt: created.record.expiresAt,
				protocol: created.record.protocol,
				hostId: created.record.hostId,
				target: created.record.target
			},
			{ status: 201 }
		);
	} catch (error) {
		return serviceJson(error);
	}
};
