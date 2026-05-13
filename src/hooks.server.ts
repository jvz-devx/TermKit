import { error, redirect, type Handle } from '@sveltejs/kit';
import { getSessionFromEvent, hasAnyUser } from '$lib/server/auth';

const firstRunPath = '/first-run';
const publicPagePaths = new Set(['/login', firstRunPath]);
const publicAuthPaths = new Set(['/auth/microsoft/login', '/auth/microsoft/callback']);

function isPublicPath(pathname: string): boolean {
	return (
		publicPagePaths.has(pathname) ||
		publicAuthPaths.has(pathname) ||
		pathname.startsWith('/favicon') ||
		isSvelteKitPath(pathname)
	);
}

function isApiPath(pathname: string): boolean {
	return pathname.startsWith('/api/') || pathname.startsWith('/ws/');
}

function isSvelteKitPath(pathname: string): boolean {
	return pathname.startsWith('/_app');
}

export const handle: Handle = async ({ event, resolve }) => {
	const session = await getSessionFromEvent(event);

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	const hasUsers = await hasAnyUser();

	if (
		!hasUsers &&
		!isPublicPath(event.url.pathname) &&
		!isApiPath(event.url.pathname) &&
		!isSvelteKitPath(event.url.pathname)
	) {
		throw redirect(302, firstRunPath);
	}

	if (!event.locals.user && !isPublicPath(event.url.pathname)) {
		if (isApiPath(event.url.pathname)) {
			throw error(401, 'Authentication required');
		}

		throw redirect(302, '/login');
	}

	return resolve(event);
};
