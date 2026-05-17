import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AuthError,
	createFirstRunAdmin,
	hasAnyUser,
	loginWithPassword,
	logout
} from '$lib/server/auth';
import { parseMicrosoftEntraAuthConfig } from '$lib/server/auth/microsoft';
import { firstRunForm, getMicrosoftAuthAvailability, loginForm, logoutForm } from './auth.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: {},
		url: new URL('https://termix.test/login')
	}
}));

const kit = vi.hoisted(() => {
	class InvalidRemoteError extends Error {
		payload: unknown;

		constructor(payload: unknown) {
			super('invalid');
			this.payload = payload;
		}
	}

	class RedirectError extends Error {
		status: number;
		location: string;

		constructor(status: number, location: string) {
			super('redirect');
			this.status = status;
			this.location = location;
		}
	}

	return {
		InvalidRemoteError,
		RedirectError,
		invalid: vi.fn((payload: unknown) => {
			throw new InvalidRemoteError(payload);
		}),
		redirect: vi.fn((status: number, location: string) => {
			throw new RedirectError(status, location);
		})
	};
});

vi.mock('$app/server', () => {
	function createIssue() {
		return {
			username: (message: string) => ({ field: 'username', message }),
			password: (message: string) => ({ field: 'password', message }),
			confirmPassword: (message: string) => ({ field: 'confirmPassword', message })
		};
	}

	function remoteCallable(type: 'form' | 'query', fn: (input?: unknown) => unknown) {
		const wrapper = vi.fn((input?: unknown) => Promise.resolve(fn(input)));
		Object.defineProperty(wrapper, '__', { value: { type } });
		return wrapper;
	}

	return {
		getRequestEvent: () => appServer.event,
		form: (...args: unknown[]) =>
			remoteCallable('form', (input?: unknown) => {
				const handler = (args.length === 1 ? args[0] : args[1]) as (
					input: unknown,
					issue: ReturnType<typeof createIssue>
				) => unknown;
				return handler(input ?? {}, createIssue());
			}),
		query: (fn: () => unknown) => remoteCallable('query', fn)
	};
});

vi.mock('@sveltejs/kit', () => ({
	invalid: kit.invalid,
	redirect: kit.redirect
}));

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

const submitLoginForm = loginForm as unknown as (input: {
	username: string;
	password: string;
}) => Promise<void>;
const submitFirstRunForm = firstRunForm as unknown as (input: {
	username: string;
	password: string;
	confirmPassword: string;
}) => Promise<void>;
const submitLogoutForm = logoutForm as unknown as () => Promise<void>;

describe('auth remote functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/login')
		};
		vi.unstubAllEnvs();
	});

	it('validates login fields before password auth', async () => {
		await expect(submitLoginForm({ username: '   ', password: 'secret' })).rejects.toMatchObject({
			payload: { field: 'username', message: 'Username is required' }
		});
		await expect(submitLoginForm({ username: 'ada', password: '' })).rejects.toMatchObject({
			payload: { field: 'password', message: 'Password is required' }
		});

		expect(loginWithPassword).not.toHaveBeenCalled();
	});

	it('redacts login auth failures into a generic invalid response', async () => {
		vi.mocked(loginWithPassword).mockRejectedValueOnce(new AuthError('password hash mismatch'));

		await expect(submitLoginForm({ username: ' ada ', password: 'secret' })).rejects.toMatchObject({
			payload: 'Invalid username or password'
		});
		expect(loginWithPassword).toHaveBeenCalledWith(appServer.event, {
			username: 'ada',
			password: 'secret'
		});
		expect(JSON.stringify(kit.invalid.mock.calls)).not.toContain('password hash mismatch');
	});

	it('logs in and redirects after successful password auth', async () => {
		vi.mocked(loginWithPassword).mockResolvedValueOnce(undefined as never);

		await expect(submitLoginForm({ username: 'ada', password: 'secret' })).rejects.toMatchObject({
			status: 303,
			location: '/hosts'
		});
		expect(loginWithPassword).toHaveBeenCalledWith(appServer.event, {
			username: 'ada',
			password: 'secret'
		});
	});

	it('redirects first-run setup away when a user already exists', async () => {
		vi.mocked(hasAnyUser).mockResolvedValueOnce(true as never);

		await expect(
			submitFirstRunForm({ username: 'ada', password: 'secret', confirmPassword: 'secret' })
		).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(createFirstRunAdmin).not.toHaveBeenCalled();
		expect(loginWithPassword).not.toHaveBeenCalled();
	});

	it('validates first-run password confirmation before creating an admin', async () => {
		vi.mocked(hasAnyUser).mockResolvedValueOnce(false as never);

		await expect(
			submitFirstRunForm({ username: 'ada', password: 'secret', confirmPassword: 'different' })
		).rejects.toMatchObject({
			payload: { field: 'confirmPassword', message: 'Passwords do not match' }
		});
		expect(createFirstRunAdmin).not.toHaveBeenCalled();
		expect(loginWithPassword).not.toHaveBeenCalled();
	});

	it('creates the first admin, logs in, and redirects to hosts', async () => {
		vi.mocked(hasAnyUser).mockResolvedValueOnce(false as never);
		vi.mocked(createFirstRunAdmin).mockResolvedValueOnce(undefined as never);
		vi.mocked(loginWithPassword).mockResolvedValueOnce(undefined as never);

		await expect(
			submitFirstRunForm({ username: ' ada ', password: 'secret', confirmPassword: 'secret' })
		).rejects.toMatchObject({
			status: 303,
			location: '/hosts'
		});
		expect(createFirstRunAdmin).toHaveBeenCalledWith({ username: 'ada', password: 'secret' });
		expect(loginWithPassword).toHaveBeenCalledWith(appServer.event, {
			username: 'ada',
			password: 'secret'
		});
	});

	it('maps first-run auth errors into invalid responses', async () => {
		vi.mocked(hasAnyUser).mockResolvedValueOnce(false as never);
		vi.mocked(createFirstRunAdmin).mockRejectedValueOnce(new AuthError('username already exists'));

		await expect(
			submitFirstRunForm({ username: 'ada', password: 'secret', confirmPassword: 'secret' })
		).rejects.toMatchObject({
			payload: 'username already exists'
		});
		expect(loginWithPassword).not.toHaveBeenCalled();
	});

	it('logs out and redirects to login', async () => {
		vi.mocked(logout).mockResolvedValueOnce(undefined as never);

		await expect(submitLogoutForm()).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(logout).toHaveBeenCalledWith(appServer.event);
	});

	it('exposes Microsoft auth login only when the provider is configured', async () => {
		vi.mocked(parseMicrosoftEntraAuthConfig).mockReturnValueOnce({
			enabled: true,
			config: {
				clientSecret: 'super-secret'
			}
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
			errors: ['MICROSOFT_CLIENT_SECRET is required']
		} as never);

		const availability = await getMicrosoftAuthAvailability();

		expect(availability).toEqual({ enabled: false, href: null });
		expect(JSON.stringify(availability)).not.toContain('MICROSOFT_CLIENT_SECRET');
	});

	it('uses configured ORIGIN for Microsoft login and callback validation inputs', async () => {
		vi.stubEnv('ORIGIN', 'https://public.termix.test');
		vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'super-secret');
		vi.mocked(parseMicrosoftEntraAuthConfig).mockReturnValueOnce({
			enabled: false,
			errors: ['MICROSOFT_REDIRECT_URI must use HTTPS outside local development']
		} as never);

		const availability = await getMicrosoftAuthAvailability();

		expect(availability).toEqual({ enabled: false, href: null });
		expect(parseMicrosoftEntraAuthConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				ORIGIN: 'https://public.termix.test',
				MICROSOFT_CLIENT_SECRET: 'super-secret'
			})
		);
		expect(JSON.stringify(availability)).not.toContain('super-secret');
	});
});
