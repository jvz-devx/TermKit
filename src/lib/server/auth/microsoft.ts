export type MicrosoftEntraAuthConfig = {
	enabled: true;
	clientId: string;
	clientSecret: string;
	tenantId: string;
	redirectUri: string;
	scopes: string[];
	allowedDomains: string[];
	adminEmails: string[];
	authorizationEndpoint: string;
	tokenEndpoint: string;
	issuer: string;
	jwksUri: string;
};

export type MicrosoftEntraAuthConfigResult =
	| { enabled: true; config: MicrosoftEntraAuthConfig }
	| { enabled: false; errors: string[] };

const defaultScopes = ['openid', 'profile', 'email'];
const enabledValues = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const domainPattern =
	/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function envValue(env: NodeJS.ProcessEnv, key: string): string | null {
	const value = env[key]?.trim();
	return value ? value : null;
}

function isEnabled(value: string | undefined): boolean {
	return enabledValues.has(value?.trim().toLowerCase() ?? '');
}

function parseScopes(value: string | null): string[] {
	if (!value) return defaultScopes;

	const scopes = value
		.split(/[,\s]+/)
		.map((scope) => scope.trim())
		.filter(Boolean);

	return Array.from(new Set(scopes));
}

function parseCsv(value: string | null): string[] {
	return (
		value
			?.split(',')
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean) ?? []
	);
}

function isTenantId(value: string): boolean {
	return uuidPattern.test(value) || domainPattern.test(value);
}

function isEmailDomain(value: string): boolean {
	return domainPattern.test(value) && !value.startsWith('*.') && !value.includes('/');
}

function isEmailAddress(value: string): boolean {
	const [localPart, domain, ...extra] = value.split('@');
	return extra.length === 0 && Boolean(localPart) && Boolean(domain) && isEmailDomain(domain);
}

function validateRedirectUri(value: string): string | null {
	let url: URL;

	try {
		url = new URL(value);
	} catch {
		return 'MICROSOFT_REDIRECT_URI must be an absolute URL';
	}

	const isLocalHttp =
		url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

	if (url.protocol !== 'https:' && !isLocalHttp) {
		return 'MICROSOFT_REDIRECT_URI must use HTTPS outside local development';
	}

	if (url.hash) return 'MICROSOFT_REDIRECT_URI must not include a fragment';
	return null;
}

function validateScopes(scopes: string[]): string | null {
	if (!scopes.includes('openid')) return 'MICROSOFT_SCOPES must include openid';
	if (scopes.some((scope) => [...scope].some((char) => char.charCodeAt(0) <= 32))) {
		return 'MICROSOFT_SCOPES must contain valid scope names';
	}
	return null;
}

export function microsoftCallbackUrlFromOrigin(origin: string): string {
	return `${new URL(origin).origin}/auth/microsoft/callback`;
}

export function parseMicrosoftEntraAuthConfig(
	env: NodeJS.ProcessEnv = process.env
): MicrosoftEntraAuthConfigResult {
	if (!isEnabled(env.MICROSOFT_AUTH_ENABLED)) return { enabled: false, errors: [] };

	const errors: string[] = [];
	const clientId = envValue(env, 'MICROSOFT_CLIENT_ID');
	const clientSecret = envValue(env, 'MICROSOFT_CLIENT_SECRET');
	const tenantId = envValue(env, 'MICROSOFT_TENANT_ID');
	const origin = envValue(env, 'ORIGIN');
	const redirectUri =
		envValue(env, 'MICROSOFT_REDIRECT_URI') ??
		(origin ? microsoftCallbackUrlFromOrigin(origin) : null);
	const scopes = parseScopes(envValue(env, 'MICROSOFT_SCOPES'));
	const allowedDomains = parseCsv(envValue(env, 'MICROSOFT_ALLOWED_DOMAINS'));
	const adminEmails = parseCsv(envValue(env, 'MICROSOFT_ADMIN_EMAILS'));

	if (!clientId) errors.push('MICROSOFT_CLIENT_ID is required');
	if (!clientSecret) errors.push('MICROSOFT_CLIENT_SECRET is required');
	if (!tenantId) errors.push('MICROSOFT_TENANT_ID is required');
	if (!redirectUri) errors.push('ORIGIN or MICROSOFT_REDIRECT_URI is required');
	if (allowedDomains.length === 0) errors.push('MICROSOFT_ALLOWED_DOMAINS is required');
	if (adminEmails.length === 0) errors.push('MICROSOFT_ADMIN_EMAILS is required');

	if (tenantId && !isTenantId(tenantId)) {
		errors.push('MICROSOFT_TENANT_ID must be a tenant UUID or verified tenant domain');
	}

	for (const domain of allowedDomains) {
		if (!isEmailDomain(domain)) errors.push('MICROSOFT_ALLOWED_DOMAINS must contain bare domains');
	}

	for (const email of adminEmails) {
		if (!isEmailAddress(email)) errors.push('MICROSOFT_ADMIN_EMAILS must contain email addresses');
	}

	if (redirectUri) {
		const redirectError = validateRedirectUri(redirectUri);
		if (redirectError) errors.push(redirectError);
	}

	const scopeError = validateScopes(scopes);
	if (scopeError) errors.push(scopeError);

	if (errors.length > 0) return { enabled: false, errors };

	const tenant = tenantId as string;
	const baseEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;

	return {
		enabled: true,
		config: {
			enabled: true,
			clientId: clientId as string,
			clientSecret: clientSecret as string,
			tenantId: tenant,
			redirectUri: redirectUri as string,
			scopes,
			allowedDomains,
			adminEmails,
			authorizationEndpoint: `${baseEndpoint}/authorize`,
			tokenEndpoint: `${baseEndpoint}/token`,
			issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
			jwksUri: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/discovery/v2.0/keys`
		}
	};
}
