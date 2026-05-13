import { describe, expect, it } from 'vitest';
import { microsoftCallbackUrlFromOrigin, parseMicrosoftEntraAuthConfig } from './microsoft';

const validEnv = {
	MICROSOFT_AUTH_ENABLED: '1',
	MICROSOFT_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
	MICROSOFT_CLIENT_SECRET: 'client-secret',
	MICROSOFT_TENANT_ID: '22222222-2222-4222-8222-222222222222',
	MICROSOFT_ALLOWED_DOMAINS: 'example.com',
	MICROSOFT_ADMIN_EMAILS: 'admin@example.com',
	ORIGIN: 'https://termix.example'
};

describe('Microsoft Entra auth config', () => {
	it('stays disabled when Microsoft auth is not enabled', () => {
		expect(parseMicrosoftEntraAuthConfig({})).toEqual({ enabled: false, errors: [] });
	});

	it('builds v2.0 endpoints from the required environment values', () => {
		const result = parseMicrosoftEntraAuthConfig(validEnv);

		expect(result).toMatchObject({
			enabled: true,
			config: {
				clientId: '11111111-1111-4111-8111-111111111111',
				clientSecret: 'client-secret',
				tenantId: '22222222-2222-4222-8222-222222222222',
				redirectUri: 'https://termix.example/auth/microsoft/callback',
				scopes: ['openid', 'profile', 'email'],
				allowedDomains: ['example.com'],
				adminEmails: ['admin@example.com'],
				authorizationEndpoint:
					'https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/oauth2/v2.0/authorize',
				tokenEndpoint:
					'https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/oauth2/v2.0/token',
				issuer: 'https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0',
				jwksUri:
					'https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/discovery/v2.0/keys'
			}
		});
	});

	it('supports an explicit redirect URI and deduplicates scopes', () => {
		const result = parseMicrosoftEntraAuthConfig({
			...validEnv,
			MICROSOFT_REDIRECT_URI: 'https://auth.termix.example/auth/microsoft/callback',
			MICROSOFT_SCOPES: 'openid profile email profile'
		});

		expect(result).toMatchObject({
			enabled: true,
			config: {
				redirectUri: 'https://auth.termix.example/auth/microsoft/callback',
				scopes: ['openid', 'profile', 'email']
			}
		});
	});

	it('reports all missing required values at once when enabled', () => {
		const result = parseMicrosoftEntraAuthConfig({ MICROSOFT_AUTH_ENABLED: '1' });

		expect(result).toEqual({
			enabled: false,
			errors: [
				'MICROSOFT_CLIENT_ID is required',
				'MICROSOFT_CLIENT_SECRET is required',
				'MICROSOFT_TENANT_ID is required',
				'ORIGIN or MICROSOFT_REDIRECT_URI is required',
				'MICROSOFT_ALLOWED_DOMAINS is required',
				'MICROSOFT_ADMIN_EMAILS is required'
			]
		});
	});

	it('rejects weak tenant, domain, email, redirect, and scope values', () => {
		const result = parseMicrosoftEntraAuthConfig({
			...validEnv,
			MICROSOFT_TENANT_ID: 'common',
			MICROSOFT_REDIRECT_URI: 'http://termix.example/auth/microsoft/callback#frag',
			MICROSOFT_SCOPES: 'profile email',
			MICROSOFT_ALLOWED_DOMAINS: '*.example.com',
			MICROSOFT_ADMIN_EMAILS: 'admin'
		});

		expect(result).toEqual({
			enabled: false,
			errors: [
				'MICROSOFT_TENANT_ID must be a tenant UUID or verified tenant domain',
				'MICROSOFT_ALLOWED_DOMAINS must contain bare domains',
				'MICROSOFT_ADMIN_EMAILS must contain email addresses',
				'MICROSOFT_REDIRECT_URI must use HTTPS outside local development',
				'MICROSOFT_SCOPES must include openid'
			]
		});
	});

	it('derives the callback URL from ORIGIN', () => {
		expect(microsoftCallbackUrlFromOrigin('https://termix.example/app')).toBe(
			'https://termix.example/auth/microsoft/callback'
		);
	});
});
