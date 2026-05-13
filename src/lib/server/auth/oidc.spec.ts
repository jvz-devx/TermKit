import { describe, expect, it } from 'vitest';
import type { MicrosoftEntraAuthConfig } from './microsoft';
import {
	OidcValidationError,
	buildMicrosoftAuthorizationUrl,
	validateMicrosoftIdTokenClaims,
	validateOidcCallbackUrl,
	validateOidcTokenResponse
} from './oidc';

const config: MicrosoftEntraAuthConfig = {
	enabled: true,
	clientId: 'client-id',
	clientSecret: 'client-secret',
	tenantId: '11111111-1111-4111-8111-111111111111',
	redirectUri: 'https://termix.example/auth/microsoft/callback',
	scopes: ['openid', 'profile', 'email'],
	allowedDomains: ['example.com'],
	adminEmails: ['admin@example.com'],
	authorizationEndpoint:
		'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/oauth2/v2.0/authorize',
	tokenEndpoint:
		'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/oauth2/v2.0/token',
	issuer: 'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0',
	jwksUri:
		'https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/discovery/v2.0/keys'
};

function encodeJwtPart(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function unsignedJwt(payload: Record<string, unknown>): string {
	return `${encodeJwtPart({ alg: 'none', typ: 'JWT' })}.${encodeJwtPart(payload)}.signature`;
}

describe('Microsoft OIDC authorization URL', () => {
	it('builds the authorization request with the required state and nonce', () => {
		const url = buildMicrosoftAuthorizationUrl(config, {
			state: 'state-value',
			nonce: 'nonce-value',
			prompt: 'select_account'
		});

		expect(url.origin + url.pathname).toBe(config.authorizationEndpoint);
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: 'client-id',
			response_type: 'code',
			redirect_uri: 'https://termix.example/auth/microsoft/callback',
			response_mode: 'query',
			scope: 'openid profile email',
			state: 'state-value',
			nonce: 'nonce-value',
			prompt: 'select_account'
		});
	});
});

describe('OIDC callback validation', () => {
	it('accepts a callback with the expected state and one authorization code', () => {
		const result = validateOidcCallbackUrl(
			'https://termix.example/auth/microsoft/callback?code=auth-code&state=state-value',
			{ expectedState: 'state-value' }
		);

		expect(result).toEqual({ code: 'auth-code', state: 'state-value' });
	});

	it('rejects provider errors and state mismatches', () => {
		expect(() =>
			validateOidcCallbackUrl(
				'https://termix.example/auth/microsoft/callback?error=access_denied&error_description=Nope&state=state-value',
				{ expectedState: 'state-value' }
			)
		).toThrow(new OidcValidationError('Nope'));
		expect(() =>
			validateOidcCallbackUrl(
				'https://termix.example/auth/microsoft/callback?code=auth-code&state=wrong-state',
				{ expectedState: 'state-value' }
			)
		).toThrow(new OidcValidationError('OIDC callback state did not match'));
	});

	it('rejects duplicated callback parameters', () => {
		expect(() =>
			validateOidcCallbackUrl(
				'https://termix.example/auth/microsoft/callback?code=one&code=two&state=state-value',
				{ expectedState: 'state-value' }
			)
		).toThrow(new OidcValidationError('OIDC callback contains multiple code values'));
	});
});

describe('OIDC token response validation', () => {
	it('accepts a complete bearer token response', () => {
		const result = validateOidcTokenResponse({
			access_token: 'access-token',
			id_token: 'id-token',
			token_type: 'Bearer',
			expires_in: 3600,
			refresh_token: 'refresh-token',
			scope: 'openid profile'
		});

		expect(result).toEqual({
			accessToken: 'access-token',
			idToken: 'id-token',
			tokenType: 'Bearer',
			expiresIn: 3600,
			refreshToken: 'refresh-token',
			scope: 'openid profile'
		});
	});

	it('rejects malformed token responses', () => {
		expect(() =>
			validateOidcTokenResponse({
				access_token: 'access-token',
				id_token: 'id-token',
				token_type: 'bearer',
				expires_in: 3600
			})
		).toThrow(new OidcValidationError('OIDC token response token_type must be Bearer'));
		expect(() =>
			validateOidcTokenResponse({
				access_token: 'access-token',
				id_token: 'id-token',
				token_type: 'Bearer',
				expires_in: 0
			})
		).toThrow(new OidcValidationError('OIDC token response expires_in must be a positive integer'));
	});
});

describe('Microsoft ID token claim validation', () => {
	const now = new Date('2026-05-13T12:00:00.000Z');
	const nowSeconds = Math.floor(now.getTime() / 1000);
	const validClaims = {
		iss: config.issuer,
		sub: 'subject',
		aud: 'client-id',
		exp: nowSeconds + 600,
		iat: nowSeconds - 60,
		nbf: nowSeconds - 60,
		nonce: 'nonce-value',
		tid: config.tenantId,
		email: 'user@example.com'
	};

	it('accepts expected issuer, audience, tenant, time window, and nonce claims', () => {
		const claims = validateMicrosoftIdTokenClaims(unsignedJwt(validClaims), config, {
			expectedNonce: 'nonce-value',
			now
		});

		expect(claims).toMatchObject(validClaims);
	});

	it('accepts concrete tenant issuers from organization-scoped Microsoft endpoints', () => {
		const organizationConfig = {
			...config,
			tenantId: 'organizations',
			issuer: 'https://login.microsoftonline.com/organizations/v2.0'
		};
		const claims = validateMicrosoftIdTokenClaims(
			unsignedJwt({
				...validClaims,
				iss: `https://login.microsoftonline.com/${config.tenantId}/v2.0`
			}),
			organizationConfig,
			{ expectedNonce: 'nonce-value', now }
		);

		expect(claims.tid).toBe(config.tenantId);
	});

	it('rejects stale or mismatched claims', () => {
		expect(() =>
			validateMicrosoftIdTokenClaims(unsignedJwt({ ...validClaims, aud: 'other-client' }), config, {
				expectedNonce: 'nonce-value',
				now
			})
		).toThrow(new OidcValidationError('OIDC ID token audience did not match'));
		expect(() =>
			validateMicrosoftIdTokenClaims(
				unsignedJwt({ ...validClaims, exp: nowSeconds - 120 }),
				config,
				{
					expectedNonce: 'nonce-value',
					now
				}
			)
		).toThrow(new OidcValidationError('OIDC ID token is expired'));
		expect(() =>
			validateMicrosoftIdTokenClaims(unsignedJwt({ ...validClaims, nonce: 'wrong' }), config, {
				expectedNonce: 'nonce-value',
				now
			})
		).toThrow(new OidcValidationError('OIDC ID token nonce did not match'));
	});
});
