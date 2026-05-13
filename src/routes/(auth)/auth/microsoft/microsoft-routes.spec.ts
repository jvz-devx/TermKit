import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
	select: vi.fn(),
	transaction: vi.fn()
}));

const auth = vi.hoisted(() => ({
	createSessionForUser: vi.fn(async () => ({
		token: 'session-token',
		session: { id: 'session-1' }
	})),
	hasAnyUser: vi.fn(async () => true),
	setSessionCookie: vi.fn(),
	shouldUseSecureSessionCookie: vi.fn(() => true)
}));

const password = vi.hoisted(() => ({
	hashPassword: vi.fn(async () => 'hashed-random-password')
}));

vi.mock('$lib/server/db', () => ({ db }));
vi.mock('$lib/server/auth/session', () => auth);
vi.mock('$lib/server/auth/password', () => password);

const originalEnv = { ...process.env };
const tenantId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';

type CookieRecord = {
	value: string;
	options: Record<string, unknown>;
};

function configureMicrosoftEnv() {
	process.env.MICROSOFT_AUTH_ENABLED = 'true';
	process.env.MICROSOFT_TENANT_ID = tenantId;
	process.env.MICROSOFT_CLIENT_ID = clientId;
	process.env.MICROSOFT_CLIENT_SECRET = 'secret-1';
	process.env.MICROSOFT_ALLOWED_DOMAINS = 'example.com';
	process.env.MICROSOFT_ADMIN_EMAILS = 'admin@example.com';
	delete process.env.ORIGIN;
}

function createCookies(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const setCalls = new Map<string, CookieRecord>();
	const deleted = new Set<string>();

	return {
		get: vi.fn((name: string) => values.get(name)),
		set: vi.fn((name: string, value: string, options: Record<string, unknown>) => {
			values.set(name, value);
			setCalls.set(name, { value, options });
		}),
		delete: vi.fn((name: string) => {
			values.delete(name);
			deleted.add(name);
		}),
		setCalls,
		deleted
	};
}

function createEvent(path: string, cookies = createCookies()) {
	const url = new URL(path, 'https://termix.test');
	return {
		url,
		request: new Request(url),
		cookies,
		getClientAddress: () => '127.0.0.1',
		locals: {}
	};
}

function expectRedirect(error: unknown, status: number): string {
	expect(error).toMatchObject({ status });
	const location = (error as { location?: string }).location;
	expect(location).toBeTruthy();
	return location as string;
}

function mockNoExistingIdentity() {
	db.select.mockReturnValue({
		from: () => ({
			where: () => ({
				limit: async () => []
			})
		})
	});
}

function mockProvisionTransaction(
	options: { existingUser?: { id: string; isAdmin: boolean } } = {}
) {
	const insertValues: unknown[] = [];
	const updateValues: unknown[] = [];

	db.transaction.mockImplementation(async (callback) => {
		let selectCount = 0;
		const txSelect = vi.fn(() => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						selectCount += 1;
						if (selectCount === 2 && options.existingUser) return [options.existingUser];
						return [];
					}
				})
			})
		}));
		const txInsert = vi.fn(() => ({
			values: (value: unknown) => {
				insertValues.push(value);
				return {
					returning: async () => [{ id: 'user-1' }]
				};
			}
		}));
		const txUpdate = vi.fn(() => ({
			set: (value: unknown) => {
				updateValues.push(value);
				return { where: async () => undefined };
			}
		}));

		return callback({ select: txSelect, insert: txInsert, update: txUpdate });
	});

	return { insertValues, updateValues };
}

function createSignedIdToken(input: {
	nonce: string;
	email?: string | null;
	preferredUsername?: string;
	domain?: string;
}) {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const kid = 'test-key';
	const header = { alg: 'RS256', kid, typ: 'JWT' };
	const email = input.email === undefined ? `admin@${input.domain ?? 'example.com'}` : input.email;
	const preferredUsername =
		input.preferredUsername ?? email ?? `admin@${input.domain ?? 'example.com'}`;
	const payload: Record<string, unknown> = {
		aud: clientId,
		exp: Math.floor(Date.now() / 1000) + 300,
		iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
		name: 'Admin User',
		nonce: input.nonce,
		preferred_username: preferredUsername,
		sub: 'subject-1',
		tid: tenantId
	};
	if (email) payload.email = email;
	const encodedHeader = encodeJwtPart(header);
	const encodedPayload = encodeJwtPart(payload);
	const signature = createSign('RSA-SHA256')
		.update(`${encodedHeader}.${encodedPayload}`)
		.sign(privateKey, 'base64url');
	const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & { kid?: string };
	jwk.kid = kid;

	return {
		idToken: `${encodedHeader}.${encodedPayload}.${signature}`,
		jwk
	};
}

function encodeJwtPart(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	configureMicrosoftEnv();
});

afterEach(() => {
	process.env = { ...originalEnv };
	vi.unstubAllGlobals();
});

describe('Microsoft auth routes', () => {
	it('redirects login requests to the tenant authorization endpoint and stores state cookies', async () => {
		expect.assertions(10);
		const { GET } = await import('./login/+server');
		const cookies = createCookies();
		const event = createEvent('/auth/microsoft/login', cookies);

		try {
			GET(event as never);
		} catch (error) {
			const location = expectRedirect(error, 302);
			const redirectUrl = new URL(location);
			expect(redirectUrl.origin).toBe('https://login.microsoftonline.com');
			expect(redirectUrl.pathname).toBe(`/${tenantId}/oauth2/v2.0/authorize`);
			expect(redirectUrl.searchParams.get('client_id')).toBe(clientId);
			expect(redirectUrl.searchParams.get('redirect_uri')).toBe(
				'https://termix.test/auth/microsoft/callback'
			);
			expect(redirectUrl.searchParams.get('scope')).toBe('openid profile email');
			expect(redirectUrl.searchParams.get('state')).toBe(
				cookies.setCalls.get('termixkit_microsoft_oauth_state')?.value
			);
			expect(redirectUrl.searchParams.get('code_challenge_method')).toBe('S256');
			expect(cookies.setCalls.get('termixkit_microsoft_oauth_nonce')?.options).toMatchObject({
				httpOnly: true,
				path: '/auth/microsoft',
				secure: true
			});
		}
	});

	it('rejects callback requests with mismatched OAuth state', async () => {
		expect.assertions(2);
		const { GET } = await import('./callback/+server');
		const cookies = createCookies({
			termixkit_microsoft_oauth_state: 'expected-state',
			termixkit_microsoft_oauth_nonce: 'expected-nonce',
			termixkit_microsoft_oauth_pkce: 'expected-pkce'
		});
		const event = createEvent('/auth/microsoft/callback?code=code-1&state=wrong-state', cookies);

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 400,
			body: { message: 'OIDC callback state did not match' }
		});
		expect(cookies.delete).toHaveBeenCalledWith(
			'termixkit_microsoft_oauth_state',
			expect.any(Object)
		);
	});

	it('provisions a domain-allowed Microsoft user and creates a TermixKit session', async () => {
		expect.assertions(11);
		const nonce = 'expected-nonce';
		const { idToken, jwk } = createSignedIdToken({ nonce });
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: 'access-token',
						expires_in: 3600,
						id_token: idToken,
						token_type: 'Bearer'
					})
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ keys: [jwk] })
				})
		);
		mockNoExistingIdentity();
		const transaction = mockProvisionTransaction();
		const { GET } = await import('./callback/+server');
		const event = createEvent(
			'/auth/microsoft/callback?code=code-1&state=expected-state',
			createCookies({
				termixkit_microsoft_oauth_state: 'expected-state',
				termixkit_microsoft_oauth_nonce: nonce,
				termixkit_microsoft_oauth_pkce: 'expected-pkce'
			})
		);

		await expect(GET(event as never)).rejects.toMatchObject({ status: 303, location: '/hosts' });
		expect(fetch).toHaveBeenNthCalledWith(
			1,
			`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
			expect.objectContaining({ method: 'POST' })
		);
		expect(fetch).toHaveBeenNthCalledWith(
			2,
			`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
		);
		expect(db.transaction).toHaveBeenCalledOnce();
		expect(password.hashPassword).toHaveBeenCalledOnce();
		expect(auth.createSessionForUser).toHaveBeenCalledWith('user-1', event);
		expect(auth.setSessionCookie).toHaveBeenCalledWith(event.cookies, 'session-token', true);
		const tx = db.transaction.mock.calls[0][0];
		expect(tx).toBeTypeOf('function');
		expect(db.select).toHaveBeenCalledOnce();
		expect(auth.shouldUseSecureSessionCookie).toHaveBeenCalled();
		expect(transaction.insertValues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ username: 'admin@example.com', isAdmin: true }),
				expect.objectContaining({
					provider: 'microsoft',
					providerSubject: 'subject-1',
					email: 'admin@example.com'
				})
			])
		);
	});

	it('auto-provisions a domain-allowed Microsoft user as a normal session user', async () => {
		expect.assertions(8);
		const nonce = 'expected-nonce';
		const { idToken, jwk } = createSignedIdToken({ nonce, email: 'user@example.com' });
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: 'access-token',
						expires_in: 3600,
						id_token: idToken,
						token_type: 'Bearer'
					})
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ keys: [jwk] })
				})
		);
		mockNoExistingIdentity();
		const transaction = mockProvisionTransaction();
		const { GET } = await import('./callback/+server');
		const event = createEvent(
			'/auth/microsoft/callback?code=code-1&state=expected-state',
			createCookies({
				termixkit_microsoft_oauth_state: 'expected-state',
				termixkit_microsoft_oauth_nonce: nonce,
				termixkit_microsoft_oauth_pkce: 'expected-pkce'
			})
		);

		await expect(GET(event as never)).rejects.toMatchObject({ status: 303, location: '/hosts' });
		expect(db.transaction).toHaveBeenCalledOnce();
		expect(db.select).toHaveBeenCalledOnce();
		expect(password.hashPassword).toHaveBeenCalledOnce();
		expect(auth.createSessionForUser).toHaveBeenCalledWith('user-1', event);
		expect(auth.setSessionCookie).toHaveBeenCalledWith(event.cookies, 'session-token', true);
		expect(transaction.updateValues).toEqual([]);
		expect(transaction.insertValues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ username: 'user@example.com', isAdmin: false }),
				expect.objectContaining({
					provider: 'microsoft',
					providerSubject: 'subject-1',
					email: 'user@example.com'
				})
			])
		);
	});

	it('uses preferred_username when Microsoft does not return an email claim', async () => {
		expect.assertions(4);
		const nonce = 'expected-nonce';
		const { idToken, jwk } = createSignedIdToken({
			nonce,
			email: null,
			preferredUsername: 'admin@example.com'
		});
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: 'access-token',
						expires_in: 3600,
						id_token: idToken,
						token_type: 'Bearer'
					})
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ keys: [jwk] })
				})
		);
		mockNoExistingIdentity();
		const transaction = mockProvisionTransaction();
		const { GET } = await import('./callback/+server');
		const event = createEvent(
			'/auth/microsoft/callback?code=code-1&state=expected-state',
			createCookies({
				termixkit_microsoft_oauth_state: 'expected-state',
				termixkit_microsoft_oauth_nonce: nonce,
				termixkit_microsoft_oauth_pkce: 'expected-pkce'
			})
		);

		await expect(GET(event as never)).rejects.toMatchObject({ status: 303, location: '/hosts' });
		expect(db.transaction).toHaveBeenCalledOnce();
		expect(transaction.insertValues).toContainEqual(
			expect.objectContaining({ username: 'admin@example.com', isAdmin: true })
		);
		expect(transaction.insertValues).toContainEqual(
			expect.objectContaining({ email: 'admin@example.com' })
		);
	});

	it('rejects preferred_username domain fallback when an email claim uses another domain', async () => {
		expect.assertions(2);
		const nonce = 'expected-nonce';
		const { idToken, jwk } = createSignedIdToken({
			nonce,
			email: 'blocked@blocked.test',
			preferredUsername: 'user@example.com'
		});
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: 'access-token',
						expires_in: 3600,
						id_token: idToken,
						token_type: 'Bearer'
					})
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ keys: [jwk] })
				})
		);
		mockNoExistingIdentity();
		const { GET } = await import('./callback/+server');
		const event = createEvent(
			'/auth/microsoft/callback?code=code-1&state=expected-state',
			createCookies({
				termixkit_microsoft_oauth_state: 'expected-state',
				termixkit_microsoft_oauth_nonce: nonce,
				termixkit_microsoft_oauth_pkce: 'expected-pkce'
			})
		);

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Microsoft account domain is not allowed' }
		});
		expect(db.transaction).not.toHaveBeenCalled();
	});

	it('rejects Microsoft users outside the configured allowed domains', async () => {
		expect.assertions(2);
		const nonce = 'expected-nonce';
		const { idToken, jwk } = createSignedIdToken({ nonce, email: 'user@blocked.test' });
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: 'access-token',
						expires_in: 3600,
						id_token: idToken,
						token_type: 'Bearer'
					})
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ keys: [jwk] })
				})
		);
		const { GET } = await import('./callback/+server');
		const event = createEvent(
			'/auth/microsoft/callback?code=code-1&state=expected-state',
			createCookies({
				termixkit_microsoft_oauth_state: 'expected-state',
				termixkit_microsoft_oauth_nonce: nonce,
				termixkit_microsoft_oauth_pkce: 'expected-pkce'
			})
		);

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Microsoft account domain is not allowed' }
		});
		expect(db.transaction).not.toHaveBeenCalled();
	});

	it('links a matching local username and promotes configured Microsoft admins', async () => {
		expect.assertions(5);
		const nonce = 'expected-nonce';
		const { idToken, jwk } = createSignedIdToken({ nonce });
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: 'access-token',
						expires_in: 3600,
						id_token: idToken,
						token_type: 'Bearer'
					})
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ keys: [jwk] })
				})
		);
		mockNoExistingIdentity();
		const transaction = mockProvisionTransaction({
			existingUser: { id: 'existing-user', isAdmin: false }
		});
		const { GET } = await import('./callback/+server');
		const event = createEvent(
			'/auth/microsoft/callback?code=code-1&state=expected-state',
			createCookies({
				termixkit_microsoft_oauth_state: 'expected-state',
				termixkit_microsoft_oauth_nonce: nonce,
				termixkit_microsoft_oauth_pkce: 'expected-pkce'
			})
		);

		await expect(GET(event as never)).rejects.toMatchObject({ status: 303, location: '/hosts' });
		expect(password.hashPassword).not.toHaveBeenCalled();
		expect(transaction.updateValues).toContainEqual({ isAdmin: true });
		expect(transaction.insertValues).toContainEqual(
			expect.objectContaining({ userId: 'existing-user', providerSubject: 'subject-1' })
		);
		expect(auth.createSessionForUser).toHaveBeenCalledWith('existing-user', event);
	});

	it('requires the first Microsoft user to be a configured admin email', async () => {
		expect.assertions(2);
		const nonce = 'expected-nonce';
		const { idToken, jwk } = createSignedIdToken({ nonce, email: 'user@example.com' });
		auth.hasAnyUser.mockResolvedValueOnce(false);
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						access_token: 'access-token',
						expires_in: 3600,
						id_token: idToken,
						token_type: 'Bearer'
					})
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ keys: [jwk] })
				})
		);
		const { GET } = await import('./callback/+server');
		const event = createEvent(
			'/auth/microsoft/callback?code=code-1&state=expected-state',
			createCookies({
				termixkit_microsoft_oauth_state: 'expected-state',
				termixkit_microsoft_oauth_nonce: nonce,
				termixkit_microsoft_oauth_pkce: 'expected-pkce'
			})
		);

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 403,
			body: { message: 'The first Microsoft sign-in must be a configured admin email' }
		});
		expect(db.transaction).not.toHaveBeenCalled();
	});
});
