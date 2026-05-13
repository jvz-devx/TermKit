import { randomBytes } from 'node:crypto';
import type { MicrosoftEntraAuthConfig } from './microsoft';

export class OidcValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OidcValidationError';
	}
}

export type OidcTokenResponse = {
	accessToken: string;
	idToken: string;
	tokenType: 'Bearer';
	expiresIn: number;
	refreshToken?: string;
	scope?: string;
};

export type OidcIdTokenClaims = {
	iss: string;
	sub: string;
	aud: string | string[];
	exp: number;
	iat?: number;
	nbf?: number;
	nonce?: string;
	tid?: string;
	email?: string;
	preferred_username?: string;
	name?: string;
	oid?: string;
};

type CallbackValidationOptions = {
	expectedState: string;
};

type IdTokenValidationOptions = {
	expectedNonce?: string;
	now?: Date;
	clockSkewSeconds?: number;
	maxAgeSeconds?: number;
};

const tenantAliases = new Set(['common', 'organizations', 'consumers']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOidcState(): string {
	return randomBytes(32).toString('base64url');
}

export function createOidcNonce(): string {
	return randomBytes(32).toString('base64url');
}

export function buildMicrosoftAuthorizationUrl(
	config: MicrosoftEntraAuthConfig,
	input: { state: string; nonce: string; prompt?: 'login' | 'none' | 'select_account' }
): URL {
	const url = new URL(config.authorizationEndpoint);
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('redirect_uri', config.redirectUri);
	url.searchParams.set('response_mode', 'query');
	url.searchParams.set('scope', config.scopes.join(' '));
	url.searchParams.set('state', input.state);
	url.searchParams.set('nonce', input.nonce);

	if (input.prompt) {
		url.searchParams.set('prompt', input.prompt);
	}

	return url;
}

function singleSearchParam(params: URLSearchParams, key: string): string | null {
	const values = params.getAll(key);

	if (values.length > 1) {
		throw new OidcValidationError(`OIDC callback contains multiple ${key} values`);
	}

	return values[0]?.trim() || null;
}

export function validateOidcCallbackUrl(
	callbackUrl: URL | string,
	options: CallbackValidationOptions
): { code: string; state: string } {
	const url = typeof callbackUrl === 'string' ? new URL(callbackUrl) : callbackUrl;
	const error = singleSearchParam(url.searchParams, 'error');
	const errorDescription = singleSearchParam(url.searchParams, 'error_description');

	if (error) {
		throw new OidcValidationError(errorDescription ?? `OIDC provider returned ${error}`);
	}

	const state = singleSearchParam(url.searchParams, 'state');
	if (!state || state !== options.expectedState) {
		throw new OidcValidationError('OIDC callback state did not match');
	}

	const code = singleSearchParam(url.searchParams, 'code');
	if (!code) {
		throw new OidcValidationError('OIDC callback is missing code');
	}

	return { code, state };
}

function objectValue(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new OidcValidationError('OIDC token response must be an object');
	}

	return value as Record<string, unknown>;
}

function stringField(
	value: Record<string, unknown>,
	key: string,
	required = true
): string | undefined {
	const field = value[key];

	if (typeof field === 'string' && field.trim()) {
		return field;
	}

	if (required) {
		throw new OidcValidationError(`OIDC token response is missing ${key}`);
	}

	return undefined;
}

export function validateOidcTokenResponse(response: unknown): OidcTokenResponse {
	const value = objectValue(response);
	const accessToken = stringField(value, 'access_token');
	const idToken = stringField(value, 'id_token');
	const tokenType = stringField(value, 'token_type');
	const refreshToken = stringField(value, 'refresh_token', false);
	const scope = stringField(value, 'scope', false);
	const expiresIn = value.expires_in;

	if (tokenType !== 'Bearer') {
		throw new OidcValidationError('OIDC token response token_type must be Bearer');
	}

	if (typeof expiresIn !== 'number' || !Number.isInteger(expiresIn) || expiresIn <= 0) {
		throw new OidcValidationError('OIDC token response expires_in must be a positive integer');
	}

	return {
		accessToken: accessToken as string,
		idToken: idToken as string,
		tokenType,
		expiresIn,
		...(refreshToken ? { refreshToken } : {}),
		...(scope ? { scope } : {})
	};
}

function base64UrlDecode(value: string): string {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
	return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

export function parseJwtPayload(token: string): Record<string, unknown> {
	const parts = token.split('.');

	if (parts.length !== 3 || parts.some((part) => !part)) {
		throw new OidcValidationError('OIDC ID token must be a compact JWT');
	}

	try {
		return objectValue(JSON.parse(base64UrlDecode(parts[1] as string)));
	} catch {
		throw new OidcValidationError('OIDC ID token payload could not be decoded');
	}
}

function stringClaim(claims: Record<string, unknown>, key: string): string {
	const value = claims[key];

	if (typeof value !== 'string' || !value.trim()) {
		throw new OidcValidationError(`OIDC ID token is missing ${key}`);
	}

	return value;
}

function numericClaim(claims: Record<string, unknown>, key: string): number {
	const value = claims[key];

	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new OidcValidationError(`OIDC ID token is missing ${key}`);
	}

	return value;
}

function audienceIncludes(audience: unknown, clientId: string): boolean {
	if (typeof audience === 'string') {
		return audience === clientId;
	}

	return Array.isArray(audience) && audience.some((value) => value === clientId);
}

function expectedIssuer(config: MicrosoftEntraAuthConfig, tenantClaim: unknown): string {
	if (uuidPattern.test(config.tenantId)) {
		return config.issuer;
	}

	if (typeof tenantClaim !== 'string' || !tenantClaim.trim()) {
		throw new OidcValidationError('OIDC ID token is missing tid');
	}

	return `https://login.microsoftonline.com/${tenantClaim}/v2.0`;
}

export function validateMicrosoftIdTokenClaims(
	idToken: string,
	config: MicrosoftEntraAuthConfig,
	options: IdTokenValidationOptions = {}
): OidcIdTokenClaims {
	const claims = parseJwtPayload(idToken);
	const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
	const clockSkewSeconds = options.clockSkewSeconds ?? 60;
	const issuer = stringClaim(claims, 'iss');
	const subject = stringClaim(claims, 'sub');
	const expiresAt = numericClaim(claims, 'exp');

	if (!subject) {
		throw new OidcValidationError('OIDC ID token subject is empty');
	}

	if (issuer !== expectedIssuer(config, claims.tid)) {
		throw new OidcValidationError('OIDC ID token issuer did not match');
	}

	if (!audienceIncludes(claims.aud, config.clientId)) {
		throw new OidcValidationError('OIDC ID token audience did not match');
	}

	if (expiresAt <= nowSeconds - clockSkewSeconds) {
		throw new OidcValidationError('OIDC ID token is expired');
	}

	if (
		typeof claims.nbf === 'number' &&
		Number.isInteger(claims.nbf) &&
		claims.nbf > nowSeconds + clockSkewSeconds
	) {
		throw new OidcValidationError('OIDC ID token is not active yet');
	}

	if (
		options.maxAgeSeconds &&
		typeof claims.iat === 'number' &&
		Number.isInteger(claims.iat) &&
		claims.iat < nowSeconds - options.maxAgeSeconds - clockSkewSeconds
	) {
		throw new OidcValidationError('OIDC ID token is too old');
	}

	if (options.expectedNonce && claims.nonce !== options.expectedNonce) {
		throw new OidcValidationError('OIDC ID token nonce did not match');
	}

	if (
		uuidPattern.test(config.tenantId) &&
		claims.tid &&
		claims.tid !== config.tenantId &&
		!tenantAliases.has(config.tenantId)
	) {
		throw new OidcValidationError('OIDC ID token tenant did not match');
	}

	return claims as OidcIdTokenClaims;
}
