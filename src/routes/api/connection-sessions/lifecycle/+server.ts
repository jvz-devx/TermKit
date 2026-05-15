import { json, type RequestHandler } from '@sveltejs/kit';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { ServiceValidationError } from '$lib/server/services/errors';
import { readJsonObject, requireUser, serviceJson } from '../../_helpers';

export const POST: RequestHandler = async (event) => {
	try {
		const userId = requireUser(event);
		const input = await readJsonObject(event.request);
		const connectionSessionId =
			typeof input.connectionSessionId === 'string' ? input.connectionSessionId : '';
		const lifecycleEvent = typeof input.event === 'string' ? input.event : '';
		const updated =
			lifecycleEvent === 'connected'
				? await connectionSessionService.markActiveForUser(userId, connectionSessionId)
				: lifecycleEvent === 'ended'
					? await connectionSessionService.endForUser(userId, connectionSessionId)
					: lifecycleEvent === 'failed'
						? await connectionSessionService.failForUser(
								userId,
								connectionSessionId,
								sanitizeConnectionErrorCode(input.errorCode)
							)
						: null;

		if (!updated) {
			throw new ServiceValidationError(['connectionSessionId is invalid or event is unsupported']);
		}

		return json({ ok: true });
	} catch (error) {
		return serviceJson(error);
	}
};

function sanitizeConnectionErrorCode(value: unknown): string {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'connection_failed';
	const sanitized = raw.toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
	return sanitized.slice(0, 120) || 'connection_failed';
}
