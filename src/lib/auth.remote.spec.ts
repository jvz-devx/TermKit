import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMicrosoftEntraAuthConfig } from '$lib/server/auth/microsoft';
import { getMicrosoftAuthAvailability } from './auth.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: {},
		url: new URL('https://termix.test/login')
	}
}));

vi.mock('$app/server', () => {
	function remoteCallable(type: 'form' | 'query', fn: (input?: unknown) => unknown) {
		const wrapper = vi.fn((input?: unknown) => Promise.resolve(fn(input)));
		Object.defineProperty(wrapper, '__', { value: { type } });
		return wrapper;
	}

	return {
		getRequestEvent: () => appServer.event,
		form: (...args: unknown[]) =>
			remoteCallable(
				'form',
				(args.length === 1 ? args[0] : args[1]) as (input?: unknown) => unknown
			),
		query: (fn: () => unknown) => remoteCallable('query', fn)
	};
});

vi.mock('$lib/server/auth', () => ({
	AuthError: class AuthError extends Error {},
	createFirstRunAdmin: vi.fn(),
	hasAnyUser: vi.fn(),
	loginWithPassword: vi.fn(),
	logout: vi.fn()
}));

vi.mock('$lib/server/auth/microsoft', () => ({
	parseMicrosoftEntraAuthConfig: vi.fn()
}));

describe('auth remote functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/login')
		};
	});

	it('exposes Microsoft auth login only when the provider is configured', async () => {
		vi.mocked(parseMicrosoftEntraAuthConfig).mockReturnValueOnce({
			enabled: true,
			config: null,
			missing: []
		} as never);

		await expect(getMicrosoftAuthAvailability()).resolves.toEqual({
			enabled: true,
			href: '/auth/microsoft/login'
		});
		expect(parseMicrosoftEntraAuthConfig).toHaveBeenCalledWith(
			expect.objectContaining({ ORIGIN: 'https://termix.test' })
		);
	});

	it('keeps Microsoft auth unavailable without exposing config details', async () => {
		vi.mocked(parseMicrosoftEntraAuthConfig).mockReturnValueOnce({
			enabled: false,
			config: null,
			missing: ['MICROSOFT_CLIENT_SECRET']
		} as never);

		const availability = await getMicrosoftAuthAvailability();

		expect(availability).toEqual({ enabled: false, href: null });
		expect(JSON.stringify(availability)).not.toContain('MICROSOFT_CLIENT_SECRET');
	});
});
