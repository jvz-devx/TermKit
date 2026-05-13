import { createHash, randomBytes } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { eq, and, gt, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import { hashPassword, verifyPassword } from './password';

export const sessionCookieName = 'termixkit_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;

export type AuthUser = {
	id: string;
	username: string;
	name?: string;
	isAdmin: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type AuthSession = {
	id: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
	lastSeenAt: Date;
	userAgent: string | null;
	ipAddress: string | null;
};

export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthError';
	}
}

export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('base64url');
}

function createSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

function sessionCookieOptions(secure: boolean) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure,
		maxAge: sessionMaxAgeSeconds
	};
}

export function setSessionCookie(cookies: Cookies, token: string, secure: boolean): void {
	cookies.set(sessionCookieName, token, sessionCookieOptions(secure));
}

export function clearSessionCookie(cookies: Cookies, secure: boolean): void {
	cookies.delete(sessionCookieName, { ...sessionCookieOptions(secure), maxAge: 0 });
}

function requestIp(event: RequestEvent): string | null {
	return (
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress()
	);
}

export async function hasAnyUser(): Promise<boolean> {
	const [row] = await db.select({ value: count() }).from(users);
	return Number(row?.value ?? 0) > 0;
}

export async function createFirstRunAdmin(input: {
	username: string;
	password: string;
}): Promise<AuthUser> {
	if (await hasAnyUser()) {
		throw new AuthError('Initial admin already exists');
	}

	const [user] = await db
		.insert(users)
		.values({
			username: input.username,
			passwordHash: await hashPassword(input.password),
			isAdmin: true
		})
		.returning({
			id: users.id,
			username: users.username,
			isAdmin: users.isAdmin,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt
		});

	if (!user) {
		throw new AuthError('Could not create initial admin');
	}

	return user;
}

export async function authenticateUser(input: {
	username: string;
	password: string;
}): Promise<AuthUser | null> {
	const [user] = await db.select().from(users).where(eq(users.username, input.username)).limit(1);

	if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
		return null;
	}

	return {
		id: user.id,
		username: user.username,
		isAdmin: user.isAdmin,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt
	};
}

export async function createSessionForUser(
	userId: string,
	event: RequestEvent
): Promise<{ token: string; session: AuthSession }> {
	const token = createSessionToken();
	const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
	const [session] = await db
		.insert(sessions)
		.values({
			userId,
			tokenHash: hashSessionToken(token),
			expiresAt,
			userAgent: event.request.headers.get('user-agent'),
			ipAddress: requestIp(event)
		})
		.returning();

	if (!session) {
		throw new AuthError('Could not create session');
	}

	return { token, session };
}

export async function getSessionFromToken(
	token: string
): Promise<{ user: AuthUser; session: AuthSession } | null> {
	const [row] = await db
		.select({
			session: sessions,
			user: {
				id: users.id,
				username: users.username,
				isAdmin: users.isAdmin,
				createdAt: users.createdAt,
				updatedAt: users.updatedAt
			}
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
		.limit(1);

	if (!row) {
		return null;
	}

	await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));

	return row;
}

export async function getSessionFromEvent(
	event: RequestEvent
): Promise<{ user: AuthUser; session: AuthSession } | null> {
	const token = event.cookies.get(sessionCookieName);

	if (!token) {
		return null;
	}

	return getSessionFromToken(token);
}

export async function revokeSessionToken(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

export async function loginWithPassword(
	event: RequestEvent,
	input: { username: string; password: string }
): Promise<{ user: AuthUser; session: AuthSession }> {
	const user = await authenticateUser(input);

	if (!user) {
		throw new AuthError('Invalid username or password');
	}

	const { token, session } = await createSessionForUser(user.id, event);
	setSessionCookie(event.cookies, token, event.url.protocol === 'https:');

	return { user, session };
}

export async function logout(event: RequestEvent): Promise<void> {
	const token = event.cookies.get(sessionCookieName);

	if (token) {
		await revokeSessionToken(token);
	}

	clearSessionCookie(event.cookies, event.url.protocol === 'https:');
}
