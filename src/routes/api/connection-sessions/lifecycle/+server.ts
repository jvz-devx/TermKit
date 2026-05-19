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
		const errorCode = sanitizeConnectionErrorCode(input.errorCode);
		const errorMessage = sanitizeConnectionErrorMessage(input.errorMessage);
		const errorDetails = sanitizeConnectionErrorDetails(input.errorDetails);
		const updated =
			lifecycleEvent === 'connected'
				? await connectionSessionService.markActiveForUser(userId, connectionSessionId)
				: lifecycleEvent === 'ended'
					? await connectionSessionService.endForUser(userId, connectionSessionId)
					: lifecycleEvent === 'failed'
						? await connectionSessionService.failForUserWithDetails(
								userId,
								connectionSessionId,
								errorCode,
								errorMessage,
								errorDetails
							)
						: null;

		if (!updated) {
			throw new ServiceValidationError(['connectionSessionId is invalid or event is unsupported']);
		}

		if (lifecycleEvent === 'failed') {
			console.error('Connection session failed', {
				userId,
				connectionSessionId,
				errorCode,
				errorMessage,
				errorDetails
			});
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

function sanitizeConnectionErrorMessage(value: unknown): string {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'Connection failed';
	return raw.slice(0, 500);
}

function sanitizeConnectionErrorDetails(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

	const allowed = new Set([
		'phase',
		'action',
		'gatewayExpired',
		'errorType',
		'errorString',
		'ironErrorKind',
		'connectionState',
		'destination',
		'gatewayPublicUrl',
		'proxyAddress',
		'expiresAt',
		'usernameProvided',
		'domainProvided',
		'domainValue',
		'usingSavedPassword',
		'desktop',
		'timeoutMs',
		'userAgent'
	]);
	const details: Record<string, unknown> = {};

	for (const [key, detailValue] of Object.entries(value)) {
		if (!allowed.has(key)) continue;
		details[key] = sanitizeConnectionErrorDetailValue(detailValue);
	}

	return details;
}

function sanitizeConnectionErrorDetailValue(value: unknown): unknown {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
	if (typeof value === 'string') return value.slice(0, 1000);
	if (Array.isArray(value)) return value.slice(0, 10).map(sanitizeConnectionErrorDetailValue);
	if (typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.slice(0, 20)
				.map(([key, nestedValue]) => [
					key.slice(0, 80),
					sanitizeConnectionErrorDetailValue(nestedValue)
				])
		);
	}

	return String(value).slice(0, 1000);
}
