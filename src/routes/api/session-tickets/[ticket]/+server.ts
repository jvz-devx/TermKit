import { json, type RequestHandler } from '@sveltejs/kit';
import { sessionTicketService } from '$lib/server/services/session-tickets';
import { requireParam, requireUser, serviceJson } from '../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const ticket = requireParam(event.params.ticket, 'ticket');
		const record = await sessionTicketService.consume(ticket, new Date(), userId);
		return json({
			ticket: {
				id: record.id,
				userId: record.userId,
				hostId: record.hostId,
				protocol: record.protocol,
				target: record.target,
				expiresAt: record.expiresAt,
				usedAt: record.usedAt
			}
		});
	} catch (error) {
		return serviceJson(error);
	}
};
