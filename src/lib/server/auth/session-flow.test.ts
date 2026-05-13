import { describe, expect, it, vi } from 'vitest';

const getSessionFromEvent = vi.fn();
const hasAnyUser = vi.fn();

vi.mock('$lib/server/auth', () => ({
	getSessionFromEvent,
	hasAnyUser
}));

type TestEvent = {
	url: URL;
	locals: Record<string, unknown>;
	cookies: { get: () => undefined };
	request: Request;
	getClientAddress: () => string;
};

function createEvent(pathname: string): TestEvent {
	const url = new URL(`https://termix.test${pathname}`);
	return {
		url,
		locals: {},
		cookies: { get: () => undefined },
		request: new Request(url),
		getClientAddress: () => '127.0.0.1'
	};
}

async function loadHandle() {
	const module = await import('../../../hooks.server');
	return module.handle;
}

describe('auth session routing', () => {
	it('redirects first-run installs to /first-run', async () => {
		expect.assertions(2);
		vi.resetModules();
		getSessionFromEvent.mockResolvedValue(null);
		hasAnyUser.mockResolvedValue(false);
		const handle = await loadHandle();
		const resolve = vi.fn(() => new Response('ok'));

		await expect(handle({ event: createEvent('/hosts') as never, resolve })).rejects.toMatchObject({
			status: 302,
			location: '/first-run'
		});
		expect(resolve).not.toHaveBeenCalled();
	});

	it('allows the first-run page before an admin exists', async () => {
		expect.assertions(2);
		vi.resetModules();
		getSessionFromEvent.mockResolvedValue(null);
		hasAnyUser.mockResolvedValue(false);
		const handle = await loadHandle();
		const resolve = vi.fn(() => new Response('first-run'));

		const response = await handle({ event: createEvent('/first-run') as never, resolve });

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('allows SvelteKit assets before an admin exists', async () => {
		expect.assertions(2);
		vi.resetModules();
		getSessionFromEvent.mockResolvedValue(null);
		hasAnyUser.mockResolvedValue(false);
		const handle = await loadHandle();
		const resolve = vi.fn(() => new Response('asset'));

		const response = await handle({
			event: createEvent('/_app/immutable/entry/start.js') as never,
			resolve
		});

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('redirects unauthenticated app pages to login once setup is complete', async () => {
		expect.assertions(2);
		vi.resetModules();
		getSessionFromEvent.mockResolvedValue(null);
		hasAnyUser.mockResolvedValue(true);
		const handle = await loadHandle();
		const resolve = vi.fn(() => new Response('ok'));

		await expect(handle({ event: createEvent('/hosts') as never, resolve })).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
		expect(resolve).not.toHaveBeenCalled();
	});

	it('redirects broken Better Auth demo pages to local login', async () => {
		expect.assertions(2);
		vi.resetModules();
		getSessionFromEvent.mockResolvedValue(null);
		hasAnyUser.mockResolvedValue(true);
		const handle = await loadHandle();
		const resolve = vi.fn(() => new Response('ok'));

		await expect(
			handle({ event: createEvent('/demo/better-auth/login') as never, resolve })
		).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
		expect(resolve).not.toHaveBeenCalled();
	});

	it('attaches authenticated session locals and resolves app pages', async () => {
		expect.assertions(3);
		vi.resetModules();
		const event = createEvent('/hosts');
		const session = {
			user: { id: 'user-1', username: 'admin', isAdmin: true },
			session: { id: 'session-1', userId: 'user-1' }
		};
		getSessionFromEvent.mockResolvedValue(session);
		hasAnyUser.mockResolvedValue(true);
		const handle = await loadHandle();
		const resolve = vi.fn(() => new Response('ok'));

		const response = await handle({ event: event as never, resolve });

		expect(response.status).toBe(200);
		expect(event.locals.user).toBe(session.user);
		expect(event.locals.session).toBe(session.session);
	});
});
