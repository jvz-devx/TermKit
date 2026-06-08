import type { RequestHandler } from '@sveltejs/kit';
import {
	proxyHttpTunnelRequest,
	resolveSshTunnelConnectTarget,
	tunnelFailureCode
} from '$lib/server/protocols/ssh-tunnel';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import { sshTunnelService } from '$lib/server/services/ssh-tunnels';
import { requireParam, requireUser, serviceJson } from '../../../../_helpers';

const handler: RequestHandler = async (event) => {
	let shouldRecordFailure = false;

	try {
		const userId = requireUser(event);
		const sessionId = requireParam(event.params.sessionId, 'sessionId');
		const session = await sshTunnelService.touchSessionForProxy(userId, sessionId);
		shouldRecordFailure = true;
		const sshTarget = await resolveSshTunnelConnectTarget(userId, session.hostId);
		const upstreamPath = buildUpstreamPath(event.url.pathname, event.url.search);
		const response = await proxyHttpTunnelRequest(sshTarget, session, event.request, upstreamPath);

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	} catch (error) {
		const userId = event.locals.user?.id;
		const sessionId = event.params.sessionId;
		const failureCode = tunnelFailureCode(error);
		if (shouldRecordFailure && userId && sessionId) {
			await sshTunnelService.failSession(userId, sessionId, failureCode).catch(() => undefined);
			await connectionSessionService
				.failForUser(userId, sessionId, failureCode)
				.catch(() => undefined);
		}
		return serviceJson(error);
	}
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;

function buildUpstreamPath(pathname: string, search: string): string {
	const match = /^\/api\/tunnels\/[^/]+\/proxy(?:\/(.*))?$/.exec(pathname);
	const encodedPath = match?.[1];
	const normalizedPath = encodedPath ? `/${encodedPath}` : '/';
	return `${normalizedPath}${search}`;
}
