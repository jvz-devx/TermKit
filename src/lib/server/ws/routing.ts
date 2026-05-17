import type { IncomingMessage } from 'node:http';
import type { Protocol } from '$lib/server/protocols';

const WS_PATH = /^\/ws\/(ssh|vnc|telnet)\/([^/]+)$/;
const SSH_LIVE_PATH = /^\/ws\/ssh\/live\/([^/]+)$/;
const SSH_TUNNEL_PATH = /^\/ws\/tunnel\/([^/]+)$/;

export type WebSocketRoute =
	| { protocol: Protocol; ticket: string; live?: false }
	| { protocol: 'ssh'; ticket: string; live: true }
	| { tunnel: true; sessionId: string };

export type OriginPolicy = {
	allowedOrigins: Set<string>;
	requireOrigin: boolean;
};

export function isIgnoredUpgradePath(url: string | undefined, ignoredPaths: RegExp[]): boolean {
	if (ignoredPaths.length === 0) return false;
	const pathname = new URL(url ?? '/', 'http://localhost').pathname;
	return ignoredPaths.some((pattern) => pattern.test(pathname));
}

export function parseWebSocketRoute(request: Pick<IncomingMessage, 'url'>): WebSocketRoute | null {
	const url = new URL(request.url ?? '/', 'http://localhost');
	const liveMatch = SSH_LIVE_PATH.exec(url.pathname);
	const tunnelMatch = SSH_TUNNEL_PATH.exec(url.pathname);

	if (liveMatch) {
		const ticket = decodeRouteSegment(liveMatch[1]);
		if (!ticket) return null;
		return {
			protocol: 'ssh',
			ticket,
			live: true
		};
	}

	if (tunnelMatch) {
		const sessionId = decodeRouteSegment(tunnelMatch[1]);
		if (!sessionId) return null;
		return {
			tunnel: true,
			sessionId
		};
	}

	const match = WS_PATH.exec(url.pathname);

	if (!match) {
		return null;
	}

	const ticket = decodeRouteSegment(match[2]);
	if (!ticket) return null;

	return {
		protocol: match[1] as Protocol,
		ticket
	};
}

export function createOriginPolicy({
	allowedOrigins,
	requireOrigin
}: {
	allowedOrigins?: string[];
	requireOrigin: boolean;
}): OriginPolicy {
	const configuredOrigins = allowedOrigins ?? configuredAllowedOrigins();

	return {
		allowedOrigins: new Set(configuredOrigins.map(normalizeOrigin).filter(isString)),
		requireOrigin
	};
}

export function isAllowedWebSocketOrigin(
	request: Pick<IncomingMessage, 'headers' | 'socket'>,
	policy: OriginPolicy
): boolean {
	const originHeader = request.headers.origin;
	const origin = Array.isArray(originHeader) ? null : normalizeOrigin(originHeader);

	if (!origin) {
		return !policy.requireOrigin;
	}

	if (policy.allowedOrigins.size > 0) {
		return policy.allowedOrigins.has(origin);
	}

	return origin === requestOrigin(request);
}

function decodeRouteSegment(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

function configuredAllowedOrigins(): string[] {
	return process.env.ORIGIN ? [process.env.ORIGIN] : [];
}

function requestOrigin(request: Pick<IncomingMessage, 'headers' | 'socket'>): string | null {
	const host = request.headers.host;
	if (!host || Array.isArray(host)) return null;

	const forwardedProto = request.headers['x-forwarded-proto'];
	const protocol =
		(Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
			?.split(',')[0]
			?.trim()
			?.toLowerCase() ?? ((request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');

	return normalizeOrigin(`${protocol}://${host}`);
}

function normalizeOrigin(value: string | undefined): string | null {
	if (!value) return null;

	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.origin;
	} catch {
		return null;
	}
}

function isString(value: string | null): value is string {
	return value !== null;
}
