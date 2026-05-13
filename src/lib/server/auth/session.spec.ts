import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AuthError,
	createFirstRunAdmin,
	hashSessionToken,
	shouldUseSecureSessionCookie
} from './session';

const db = vi.hoisted(() => ({
	transaction: vi.fn(),
	select: vi.fn()
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
