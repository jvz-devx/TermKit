import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AuthError,
	authenticateUser,
	createSessionForUser,
	createFirstRunAdmin,
	getSessionFromToken,
	hashSessionToken,
	revokeSessionToken,
	shouldUseSecureSessionCookie
} from './session';

const db = vi.hoisted(() => ({
	delete: vi.fn(),
	insert: vi.fn(),
	transaction: vi.fn(),
	select: vi.fn(),
	update: vi.fn()
}));

const password = vi.hoisted(() => ({
	hashPassword: vi.fn(async (value: string) => `hashed:${value}`),
	verifyPassword: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ db }));
vi.mock('./password', () => password);

const originalNodeEnv = process.env.NODE_ENV;
const originalOrigin = process.env.ORIGIN;
const originalAppSecret = process.env.APP_SECRET;

function requestEvent(url: string, headers?: HeadersInit) {
	return {
		url: new URL(url),
		request: new Request(url, { headers })
	};
}

function authRequestEvent(url: string, headers?: HeadersInit) {
	return {
		...requestEvent(url, headers),
		getClientAddress: () => '127.0.0.1'
	};
}

afterEach(() => {
	vi.clearAllMocks();

	if (originalNodeEnv === undefined) {
		delete process.env.NODE_ENV;
	} else {
		process.env.NODE_ENV = originalNodeEnv;
	}

	if (originalOrigin === undefined) {
		delete process.env.ORIGIN;
	} else {
		process.env.ORIGIN = originalOrigin;
	}

	if (originalAppSecret === undefined) {
		delete process.env.APP_SECRET;
	} else {
		process.env.APP_SECRET = originalAppSecret;
	}
});

describe('session token hashing', () => {
	it('keys persisted session hashes with APP_SECRET when configured', () => {
		process.env.APP_SECRET = 'first-secret-with-enough-entropy';
		const firstHash = hashSessionToken('opaque-session-token');

		process.env.APP_SECRET = 'second-secret-with-enough-entropy';
		const secondHash = hashSessionToken('opaque-session-token');

		delete process.env.APP_SECRET;
		const fallbackHash = hashSessionToken('opaque-session-token');

		expect(firstHash).not.toBe(secondHash);
		expect(firstHash).not.toBe(fallbackHash);
		expect(secondHash).not.toBe(fallbackHash);
	});
});

describe('session cookie security', () => {
	it('uses secure cookies for direct HTTPS requests', () => {
		process.env.NODE_ENV = 'development';
		delete process.env.ORIGIN;

		expect(shouldUseSecureSessionCookie(requestEvent('https://termix.test/login'))).toBe(true);
	});

	it('keeps local HTTP development cookies non-secure despite proxy-looking headers', () => {
		process.env.NODE_ENV = 'development';
		process.env.ORIGIN = 'https://termix.example';

		expect(
			shouldUseSecureSessionCookie(
				requestEvent('http://localhost:5173/login', { 'x-forwarded-proto': 'https' })
			)
		).toBe(false);
	});

	it('uses secure cookies in production when ORIGIN is HTTPS behind a reverse proxy', () => {
		process.env.NODE_ENV = 'production';
		process.env.ORIGIN = 'https://termix.example';

		expect(
			shouldUseSecureSessionCookie(
				requestEvent('http://termix.internal/login', { 'x-forwarded-proto': 'http' })
			)
		).toBe(true);
	});

	it('does not let forwarded HTTPS override an explicit HTTP production ORIGIN', () => {
		process.env.NODE_ENV = 'production';
		process.env.ORIGIN = 'http://termix.example';

		expect(
			shouldUseSecureSessionCookie(
				requestEvent('http://termix.example/login', { 'x-forwarded-proto': 'https' })
			)
		).toBe(false);
	});

	it('uses forwarded HTTPS as the production fallback when ORIGIN is not configured', () => {
		process.env.NODE_ENV = 'production';
		delete process.env.ORIGIN;

		expect(
			shouldUseSecureSessionCookie(
				requestEvent('http://termix.internal/login', { 'x-forwarded-proto': 'https, http' })
			)
		).toBe(true);
	});
});

describe('first-run admin creation', () => {
	it('serializes concurrent setup attempts so only one initial admin is inserted', async () => {
		let userCount = 0;
		let transactionQueue = Promise.resolve<unknown>(undefined);
		const createdAt = new Date('2026-01-01T00:00:00.000Z');
		const execute = vi.fn(async () => undefined);
		const selectFrom = vi.fn(async () => [{ value: userCount }]);
		const select = vi.fn(() => ({ from: selectFrom }));
		const returning = vi.fn(async () => {
			userCount += 1;
			return [
				{
					id: `user-${userCount}`,
					username: 'admin',
					isAdmin: true,
					createdAt,
					updatedAt: createdAt
				}
			];
		});
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));
		const tx = { execute, select, insert };

		db.transaction.mockImplementation((callback) => {
			const result = transactionQueue.then(() => callback(tx));
			transactionQueue = result.catch(() => undefined);
			return result;
		});

		const results = await Promise.allSettled([
			createFirstRunAdmin({ username: 'admin', password: 'first-password' }),
			createFirstRunAdmin({ username: 'admin2', password: 'second-password' })
		]);

		expect(results[0]).toMatchObject({
			status: 'fulfilled',
			value: { id: 'user-1', username: 'admin', isAdmin: true }
		});
		expect(results[1].status).toBe('rejected');
		if (results[1].status === 'rejected') {
			expect(results[1].reason).toBeInstanceOf(AuthError);
			expect(results[1].reason.message).toBe('Initial admin already exists');
		}
		expect(db.select).not.toHaveBeenCalled();
		expect(db.transaction).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(select).toHaveBeenCalledTimes(2);
		expect(insert).toHaveBeenCalledOnce();
		expect(values).toHaveBeenCalledWith({
			username: 'admin',
			passwordHash: 'hashed:first-password',
			isAdmin: true
		});
	});
});

describe('local session flow', () => {
	it('authenticates, creates, looks up, and revokes a local user session', async () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		const user = {
			id: 'user-1',
			username: 'admin',
			passwordHash: 'hashed:correct-password',
			isAdmin: true,
			createdAt: now,
			updatedAt: now
		};
		const session = {
			id: 'session-1',
			userId: user.id,
			tokenHash: 'stored-token-hash',
			expiresAt: new Date('2026-02-01T00:00:00.000Z'),
			createdAt: now,
			lastSeenAt: now,
			userAgent: 'vitest',
			ipAddress: '127.0.0.1'
		};
		const authenticateLimit = vi.fn(async () => [user]);
		const authenticateWhere = vi.fn(() => ({ limit: authenticateLimit }));
		const authenticateFrom = vi.fn(() => ({ where: authenticateWhere }));
		const lookupLimit = vi.fn(async () => [{ session, user }]);
		const lookupWhere = vi.fn(() => ({ limit: lookupLimit }));
		const lookupInnerJoin = vi.fn(() => ({ where: lookupWhere }));
		const lookupFrom = vi.fn(() => ({ innerJoin: lookupInnerJoin }));
		db.select
			.mockReturnValueOnce({ from: authenticateFrom })
			.mockReturnValueOnce({ from: lookupFrom });
		const insertReturning = vi.fn(async () => [session]);
		const insertValues = vi.fn(() => ({ returning: insertReturning }));
		db.insert.mockReturnValue({ values: insertValues });
		const updateWhere = vi.fn(async () => undefined);
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		db.update.mockReturnValue({ set: updateSet });
		const deleteWhere = vi.fn(async () => undefined);
		db.delete.mockReturnValue({ where: deleteWhere });
		password.verifyPassword.mockResolvedValue(true);

		const authenticated = await authenticateUser({
			username: 'admin',
			password: 'correct-password'
		});
		expect(authenticated).toMatchObject({
			id: user.id,
			username: user.username,
			isAdmin: true
		});
		expect(password.verifyPassword).toHaveBeenCalledWith('correct-password', user.passwordHash);

		const event = authRequestEvent('https://termix.test/login', { 'user-agent': 'vitest' });
		const created = await createSessionForUser(
			user.id,
			event as Parameters<typeof createSessionForUser>[1]
		);
		expect(created.session).toBe(session);
		expect(created.token).toHaveLength(43);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: user.id,
				tokenHash: hashSessionToken(created.token),
				userAgent: 'vitest',
				ipAddress: '127.0.0.1'
			})
		);

		const lookedUp = await getSessionFromToken(created.token);
		expect(lookedUp).toEqual({ session, user });
		expect(updateSet).toHaveBeenCalledWith({ lastSeenAt: expect.any(Date) });

		await revokeSessionToken(created.token);
		expect(deleteWhere).toHaveBeenCalledOnce();
	});

	it('rejects invalid local credentials without creating a session', async () => {
		const selectLimit = vi.fn(async () => [
			{
				id: 'user-1',
				username: 'admin',
				passwordHash: 'hashed:correct-password',
				isAdmin: true,
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-01-01T00:00:00.000Z')
			}
		]);
		const selectWhere = vi.fn(() => ({ limit: selectLimit }));
		const selectFrom = vi.fn(() => ({ where: selectWhere }));
		db.select.mockReturnValue({ from: selectFrom });
		password.verifyPassword.mockResolvedValue(false);

		await expect(
			authenticateUser({ username: 'admin', password: 'wrong-password' })
		).resolves.toBeNull();
		expect(db.insert).not.toHaveBeenCalled();
	});
});
