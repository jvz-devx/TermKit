import { error, redirect, type Handle } from '@sveltejs/kit';
import { getSessionFromEvent, hasAnyUser } from '$lib/server/auth';

const publicPagePaths = new Set(['/login', '/setup']);

function isPublicPath(pathname: string): boolean {
	return (
		publicPagePaths.has(pathname) ||
		pathname.startsWith('/demo') ||
		pathname.startsWith('/favicon') ||
		pathname.startsWith('/_app')
	);
}

function isApiPath(pathname: string): boolean {
	return pathname.startsWith('/api/') || pathname.startsWith('/ws/');
}

export const handle: Handle = async ({ event, resolve }) => {
	const session = await getSessionFromEvent(event);

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	const hasUsers = await hasAnyUser();

	if (!hasUsers && event.url.pathname !== '/setup' && !isApiPath(event.url.pathname)) {
		throw redirect(302, '/setup');
	}

	if (!event.locals.user && !isPublicPath(event.url.pathname)) {
		if (isApiPath(event.url.pathname)) {
			throw error(401, 'Authentication required');
		}

		throw redirect(302, '/login');
	}

	return resolve(event);
};
