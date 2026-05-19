import { recordRdpSessionLifecycle } from '$lib/remotes/sessions.remote';

export type RdpConnectionState =
	| 'loading'
	| 'ready'
	| 'connecting'
	| 'connected'
	| 'error'
	| 'disconnected';
export type RdpLifecycleEvent = 'connected' | 'ended' | 'failed';

export function isGatewayExpired(expiresAt?: string | null, now = Date.now()) {
	if (!expiresAt) return false;
	return now >= new Date(expiresAt).getTime();
}

export function lifecycleEventOnDispose(connectionState: RdpConnectionState) {
	if (connectionState === 'error') {
		return { event: 'failed' as const, errorCode: 'rdp_client_pane_abandoned_error' };
	}

	if (
		connectionState === 'loading' ||
		connectionState === 'ready' ||
		connectionState === 'connecting' ||
		connectionState === 'connected' ||
		connectionState === 'disconnected'
	) {
		return { event: 'ended' as const };
	}

	return null;
}

export async function recordRdpLifecycleEvent({
	connectionSessionId,
	event,
	errorCode,
	errorMessage,
	errorDetails,
	onError = console.warn
}: {
	connectionSessionId?: string | null;
	event: RdpLifecycleEvent;
	errorCode?: string;
	errorMessage?: string;
	errorDetails?: Record<string, unknown>;
	onError?: (message: string, caught: unknown) => void;
}) {
	if (!connectionSessionId) return;
	await recordRdpSessionLifecycle({
		connectionSessionId,
		event,
		errorCode,
		errorMessage,
		errorDetails
	}).catch((caught) => {
		onError('Could not record RDP lifecycle event', caught);
	});
}
