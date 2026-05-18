import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';
import { error, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { authIdentities, users } from '$lib/server/db/schema';
import {
	parseMicrosoftEntraAuthConfig,
	type MicrosoftEntraAuthConfig
} from '$lib/server/auth/microsoft';
import {
	AuthError,
	createSessionForUser,
	hasAnyUser,
	setSessionCookie,
	shouldUseSecureSessionCookie
} from '$lib/server/auth/session';
import { hashPassword } from '$lib/server/auth/password';
import {
	MicrosoftInvitationRequiredError,
	markMicrosoftInvitationAccepted,
	requireActiveMicrosoftInvitation
} from '$lib/server/services/microsoft-invitations';
import {
	buildMicrosoftAuthorizationUrl,
	createOidcNonce,
	createOidcState,
	OidcValidationError,
	validateMicrosoftIdTokenClaims,
	validateOidcCallbackUrl,
	validateOidcTokenResponse,
	type OidcIdTokenClaims
} from '$lib/server/auth/oidc';

const provider = 'microsoft';
const stateCookieName = 'termkit_microsoft_oauth_state';
const nonceCookieName = 'termkit_microsoft_oauth_nonce';
const pkceCookieName = 'termkit_microsoft_oauth_pkce';
const oauthCookieMaxAgeSeconds = 10 * 60;

type TokenResponse = {
	idToken: string;
};

type JwtHeader = {
	alg?: string;
	kid?: string;
};

type Jwks = {
	keys?: Array<JsonWebKey & { kid?: string }>;
};

export function loadMicrosoftAuthConfig(event: RequestEvent): MicrosoftEntraAuthConfig | null {
	const result = parseMicrosoftEntraAuthConfig({
		...process.env,
		ORIGIN: process.env.ORIGIN ?? event.url.origin
	});

	return result.enabled ? result.config : null;
}

export function ensureMicrosoftAuthEnabled(event: RequestEvent): MicrosoftEntraAuthConfig {
	const config = loadMicrosoftAuthConfig(event);
	if (!config) error(404, 'Microsoft authentication is not enabled');
	return config;
}

export function createMicrosoftAuthorizationRedirect(event: RequestEvent): never {
	const config = ensureMicrosoftAuthEnabled(event);
	const state = createOidcState();
	const nonce = createOidcNonce();
	const pkceVerifier = createPkceVerifier();

	setOAuthCookie(event.cookies, stateCookieName, state, event);
	setOAuthCookie(event.cookies, nonceCookieName, nonce, event);
	setOAuthCookie(event.cookies, pkceCookieName, pkceVerifier, event);

	const authorizeUrl = buildMicrosoftAuthorizationUrl(config, {
		state,
		nonce,
		prompt: 'select_account'
	});
	authorizeUrl.searchParams.set('code_challenge', pkceChallenge(pkceVerifier));
	authorizeUrl.searchParams.set('code_challenge_method', 'S256');

	redirect(302, authorizeUrl.toString());
}

export async function completeMicrosoftCallback(event: RequestEvent): Promise<never> {
	const config = ensureMicrosoftAuthEnabled(event);
	const expectedState = event.cookies.get(stateCookieName);
	const expectedNonce = event.cookies.get(nonceCookieName);
	const pkceVerifier = event.cookies.get(pkceCookieName);

	clearOAuthCookie(event.cookies, stateCookieName, event);
	clearOAuthCookie(event.cookies, nonceCookieName, event);
	clearOAuthCookie(event.cookies, pkceCookieName, event);

	if (!expectedState) error(400, 'Invalid Microsoft OAuth state');
	if (!expectedNonce) error(400, 'Missing Microsoft OAuth nonce');
	if (!pkceVerifier) error(400, 'Missing Microsoft OAuth PKCE verifier');

	let code: string;
	try {
		({ code } = validateOidcCallbackUrl(event.url, { expectedState }));
	} catch (caught) {
		if (caught instanceof OidcValidationError) error(400, caught.message);
		throw caught;
	}

	const tokenResponse = await exchangeCodeForTokens(config, code, pkceVerifier);
	const claims = await verifyMicrosoftIdToken(tokenResponse.idToken, config, expectedNonce);
	const email = identityEmail(claims, config.allowedDomains);
	if (!email) error(400, 'Microsoft account did not provide an email address');

	const normalizedEmail = email.toLowerCase();
	const isMicrosoftAdmin = config.adminEmails.includes(normalizedEmail);
	const hasExistingUsers = await hasAnyUser();
	if (!isMicrosoftAdmin && !hasExistingUsers) {
		error(403, 'The first Microsoft sign-in must be a configured admin email');
	}

	let userId: string;
	try {
		userId = await findOrCreateMicrosoftUser({
			tenantId: config.tenantId,
			subject: requiredClaim(claims.sub, 'sub'),
			email: normalizedEmail,
			displayName: claims.name ?? normalizedEmail,
			isAdmin: isMicrosoftAdmin,
			invitationRequired: hasExistingUsers,
			claims
		});
	} catch (caught) {
		if (caught instanceof MicrosoftInvitationRequiredError) error(403, caught.message);
		throw caught;
	}
	let token: string;
	try {
		({ token } = await createSessionForUser(userId, event));
	} catch (caught) {
		if (caught instanceof AuthError) error(403, caught.message);
		throw caught;
	}
	setSessionCookie(event.cookies, token, shouldUseSecureSessionCookie(event));

	redirect(303, '/hosts');
}

async function exchangeCodeForTokens(
	config: MicrosoftEntraAuthConfig,
	code: string,
	pkceVerifier: string
): Promise<TokenResponse> {
	const response = await fetch(config.tokenEndpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			code_verifier: pkceVerifier,
			grant_type: 'authorization_code',
			redirect_uri: config.redirectUri,
			scope: config.scopes.join(' ')
		})
	});
	const payload = await response.json().catch(() => ({}));

	if (!response.ok) {
		const value = payload as { error_description?: string; error?: string };
		error(502, value.error_description ?? value.error ?? 'Microsoft token exchange failed');
	}

	try {
		return validateOidcTokenResponse(payload);
	} catch (caught) {
		if (caught instanceof OidcValidationError) error(502, caught.message);
		throw caught;
	}
}

async function verifyMicrosoftIdToken(
	idToken: string,
	config: MicrosoftEntraAuthConfig,
	expectedNonce: string
): Promise<OidcIdTokenClaims> {
	const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');
	if (!encodedHeader || !encodedPayload || !encodedSignature)
		error(400, 'Invalid Microsoft id_token');

	const header = parseJwtPart<JwtHeader>(encodedHeader);
	if (header.alg !== 'RS256' || !header.kid) error(400, 'Unsupported Microsoft id_token signature');

	const key = await fetchMicrosoftSigningKey(config.jwksUri, header.kid);
	const signatureValid = verify(
		'RSA-SHA256',
		Buffer.from(`${encodedHeader}.${encodedPayload}`),
		createPublicKey({ key, format: 'jwk' }),
		base64UrlDecode(encodedSignature)
	);
	if (!signatureValid) error(400, 'Invalid Microsoft id_token signature');

	try {
		return validateMicrosoftIdTokenClaims(idToken, config, { expectedNonce });
	} catch (caught) {
		if (caught instanceof OidcValidationError) error(400, caught.message);
		throw caught;
	}
}

async function fetchMicrosoftSigningKey(jwksUri: string, kid: string): Promise<JsonWebKey> {
	const response = await fetch(jwksUri);
	const payload = (await response.json().catch(() => ({}))) as Jwks;

	if (!response.ok || !Array.isArray(payload.keys))
		error(502, 'Could not load Microsoft signing keys');

	const key = payload.keys.find((candidate) => candidate.kid === kid);
	if (!key) error(400, 'Microsoft id_token signing key was not found');

	return key;
}

async function findOrCreateMicrosoftUser(input: {
	tenantId: string;
	subject: string;
	email: string;
	displayName: string;
	isAdmin: boolean;
	invitationRequired: boolean;
	claims: OidcIdTokenClaims;
}): Promise<string> {
	const [existing] = await db
		.select({ userId: authIdentities.userId })
		.from(authIdentities)
		.where(
			and(
				eq(authIdentities.provider, provider),
				eq(authIdentities.tenantId, input.tenantId),
				eq(authIdentities.providerSubject, input.subject)
			)
		)
		.limit(1);

	if (existing) {
		await promoteMicrosoftAdminIfNeeded(existing.userId, input.isAdmin);
		return existing.userId;
	}

	return db.transaction(async (tx) => {
		const [racedIdentity] = await tx
			.select({ userId: authIdentities.userId })
			.from(authIdentities)
			.where(
				and(
					eq(authIdentities.provider, provider),
					eq(authIdentities.tenantId, input.tenantId),
					eq(authIdentities.providerSubject, input.subject)
				)
			)
			.limit(1);

		if (racedIdentity) {
			await promoteMicrosoftAdminIfNeeded(racedIdentity.userId, input.isAdmin);
			return racedIdentity.userId;
		}

		const invitation = input.invitationRequired
			? await requireActiveMicrosoftInvitation(input.email, tx)
			: null;
		const isAdmin = input.isAdmin || Boolean(invitation?.isAdmin);

		const [existingUser] = await tx
			.select({ id: users.id, isAdmin: users.isAdmin })
			.from(users)
			.where(eq(users.username, input.email))
			.limit(1);
		const userId =
			existingUser?.id ??
			(
				await tx
					.insert(users)
					.values({
						username: input.email,
						passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
						isAdmin
					})
					.returning({ id: users.id })
			)[0]?.id;

		if (!userId) error(500, 'Could not provision Microsoft user');
		if (existingUser && isAdmin && !existingUser.isAdmin) {
			await tx.update(users).set({ isAdmin: true }).where(eq(users.id, existingUser.id));
		}

		await tx.insert(authIdentities).values({
			userId,
			provider,
			tenantId: input.tenantId,
			providerSubject: input.subject,
			email: input.email,
			displayName: input.displayName,
			metadata: {
				preferredUsername: input.claims.preferred_username ?? null
			}
		});

		if (invitation) {
			await markMicrosoftInvitationAccepted({ email: input.email, userId, client: tx });
		}

		return userId;
	});
}

async function promoteMicrosoftAdminIfNeeded(
	userId: string,
	shouldBeAdmin: boolean
): Promise<void> {
	if (!shouldBeAdmin) return;
	await db.update(users).set({ isAdmin: true }).where(eq(users.id, userId));
}

function createPkceVerifier(): string {
	return randomBytes(32).toString('base64url');
}

function pkceChallenge(verifier: string): string {
	return createHash('sha256').update(verifier).digest('base64url');
}

function setOAuthCookie(
	cookies: Cookies,
	name: string,
	value: string,
	event: Pick<RequestEvent, 'request' | 'url'>
): void {
	cookies.set(name, value, {
		path: '/auth/microsoft',
		httpOnly: true,
		sameSite: 'lax',
		secure: shouldUseSecureSessionCookie(event),
		maxAge: oauthCookieMaxAgeSeconds
	});
}

function clearOAuthCookie(
	cookies: Cookies,
	name: string,
	event: Pick<RequestEvent, 'request' | 'url'>
): void {
	cookies.delete(name, {
		path: '/auth/microsoft',
		httpOnly: true,
		sameSite: 'lax',
		secure: shouldUseSecureSessionCookie(event),
		maxAge: 0
	});
}

function identityEmail(claims: OidcIdTokenClaims, allowedDomains: string[]): string | null {
	const candidates = uniqueStrings([claims.email, claims.preferred_username]).map((candidate) =>
		candidate.toLowerCase()
	);

	if (candidates.length === 0) return null;

	const allowedCandidate = candidates.find((candidate) => {
		const domain = candidate.split('@')[1] ?? '';
		return allowedDomains.includes(domain);
	});
	if (allowedCandidate) return allowedCandidate;

	error(403, 'Microsoft account domain is not allowed');
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function requiredClaim(value: string | undefined, name: string): string {
	if (!value) error(400, `Microsoft id_token missing ${name}`);
	return value;
}

function parseJwtPart<T>(part: string): T {
	try {
		return JSON.parse(base64UrlDecode(part).toString('utf8')) as T;
	} catch {
		error(400, 'Invalid Microsoft id_token');
	}
}

function base64UrlDecode(value: string): Buffer {
	return Buffer.from(value, 'base64url');
}
