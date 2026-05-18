import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function validateProductionEnv(env = process.env) {
	if (env.NODE_ENV !== 'production') return;

	const origin = parseOrigin(env.ORIGIN);
	const allowInsecureLocalHttp = isEnabled(env.TERMKIT_INSECURE_LOCAL_HTTP);

	validateAppSecret(env.APP_SECRET);
	validateCredentialMasterKey(env.CREDENTIAL_MASTER_KEY);
	validateDatabaseUrl(env.DATABASE_URL);
	validateGatewayUrl(env.GATEWAY_URL);
	validateGatewayPublicUrl(env.GATEWAY_PUBLIC_URL, allowInsecureLocalHttp);
	validateGatewayProvisionerKey(env.GATEWAY_PROVISIONER_KEY);
	validateMicrosoftAuth(env);

	if (origin.protocol === 'https:') return;

	if (!allowInsecureLocalHttp) {
		throw new Error(
			'ORIGIN must use https:// in production. For direct local HTTP only, set TERMKIT_INSECURE_LOCAL_HTTP=1.'
		);
	}

	if (origin.protocol !== 'http:' || !isLocalHostname(origin.hostname)) {
		throw new Error(
			'TERMKIT_INSECURE_LOCAL_HTTP=1 only permits local http://localhost or loopback ORIGIN values.'
		);
	}
}

/**
 * @param {string | undefined} value
 * @returns {URL}
 */
function parseOrigin(value) {
	if (!value) {
		throw new Error('ORIGIN is required in production.');
	}

	try {
		return new URL(value);
	} catch {
		throw new Error(`ORIGIN must be an absolute URL, received: ${value}`);
	}
}

/**
 * @param {string | undefined} value
 */
function isEnabled(value) {
	return value === '1' || value?.toLowerCase() === 'true';
}

/**
 * @param {string} hostname
 */
function isLocalHostname(hostname) {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return (
		normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
	);
}

/**
 * @param {string | undefined} appSecret
 */
function validateAppSecret(appSecret) {
	if (!appSecret) {
		throw new Error('APP_SECRET is required in production.');
	}

	if (!isStrongProductionSecret(appSecret)) {
		throw new Error('APP_SECRET must be at least 32 bytes and high-entropy in production.');
	}
}

/**
 * @param {string | undefined} masterKey
 */
function validateCredentialMasterKey(masterKey) {
	if (!masterKey) {
		throw new Error('CREDENTIAL_MASTER_KEY is required in production.');
	}

	if (!isStrongProductionSecret(masterKey)) {
		throw new Error(
			'CREDENTIAL_MASTER_KEY must be at least 32 bytes and high-entropy in production.'
		);
	}
}

/**
 * @param {string | undefined} value
 */
function validateDatabaseUrl(value) {
	if (!value) {
		throw new Error('DATABASE_URL is required in production.');
	}

	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('DATABASE_URL must be an absolute Postgres URL.');
	}

	if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
		throw new Error('DATABASE_URL must use postgres:// or postgresql:// in production.');
	}

	if (!url.hostname || !url.pathname || url.pathname === '/') {
		throw new Error('DATABASE_URL must include a database host and name in production.');
	}
}

/**
 * @param {string | undefined} value
 */
function validateGatewayUrl(value) {
	if (!value) {
		throw new Error('GATEWAY_URL is required in production for Gateway provisioning.');
	}

	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`GATEWAY_URL must be an absolute URL, received: ${value}`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('GATEWAY_URL must use http:// or https:// in production.');
	}

	if (url.username || url.password || url.hash) {
		throw new Error('GATEWAY_URL must not include credentials or fragments.');
	}
}

/**
 * @param {string | undefined} value
 * @param {boolean} allowInsecureLocalHttp
 */
function validateGatewayPublicUrl(value, allowInsecureLocalHttp) {
	if (!value) {
		throw new Error('GATEWAY_PUBLIC_URL is required in production for browser RDP launches.');
	}

	let url;
	let optedInLocalHttp = false;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`GATEWAY_PUBLIC_URL must be an absolute URL, received: ${value}`);
	}

	if (url.username || url.password || url.hash) {
		throw new Error('GATEWAY_PUBLIC_URL must not include credentials or fragments.');
	}

	if (url.protocol !== 'https:') {
		if (!allowInsecureLocalHttp) {
			throw new Error(
				'GATEWAY_PUBLIC_URL must use https:// in production. For direct local HTTP only, set TERMKIT_INSECURE_LOCAL_HTTP=1.'
			);
		}

		if (url.protocol !== 'http:' || !isLocalHostname(url.hostname)) {
			throw new Error(
				'TERMKIT_INSECURE_LOCAL_HTTP=1 only permits local http://localhost or loopback GATEWAY_PUBLIC_URL values.'
			);
		}

		optedInLocalHttp = true;
	}

	if (url.pathname !== '/gateway' && url.pathname !== '/gateway/') {
		throw new Error('GATEWAY_PUBLIC_URL must use the app /gateway proxy path.');
	}

	if (optedInLocalHttp) return;

	if (isInternalGatewayHostname(url.hostname)) {
		throw new Error(
			'GATEWAY_PUBLIC_URL must be browser-reachable in production, not localhost, loopback, wildcard, or the internal Compose gateway hostname.'
		);
	}
}

/**
 * @param {string | undefined} value
 */
function validateGatewayProvisionerKey(value) {
	if (!value?.trim()) {
		throw new Error('GATEWAY_PROVISIONER_KEY is required in production for Gateway provisioning.');
	}
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
function validateMicrosoftAuth(env) {
	if (!isEnabled(env.MICROSOFT_AUTH_ENABLED)) return;

	validateMicrosoftTenantId(env.MICROSOFT_TENANT_ID);
	validateMicrosoftClientId(env.MICROSOFT_CLIENT_ID);
	validateMicrosoftClientSecret(env.MICROSOFT_CLIENT_SECRET);
	validateMicrosoftAllowedDomains(env.MICROSOFT_ALLOWED_DOMAINS);
	validateMicrosoftAdminEmails(env.MICROSOFT_ADMIN_EMAILS);
	validateMicrosoftRedirectUri(
		env.MICROSOFT_REDIRECT_URI,
		isEnabled(env.TERMKIT_INSECURE_LOCAL_HTTP)
	);
	validateMicrosoftScopes(env.MICROSOFT_SCOPES);
}

/**
 * @param {string | undefined} value
 */
function validateMicrosoftTenantId(value) {
	const tenantId = value?.trim();
	if (!tenantId) {
		throw new Error('MICROSOFT_TENANT_ID is required when Microsoft auth is enabled.');
	}

	if (['common', 'organizations', 'consumers'].includes(tenantId.toLowerCase())) {
		throw new Error('MICROSOFT_TENANT_ID must be a tenant-specific ID or domain.');
	}

	if (!isUuid(tenantId) && !isDomainName(tenantId)) {
		throw new Error('MICROSOFT_TENANT_ID must be a tenant UUID or verified tenant domain.');
	}
}

/**
 * @param {string | undefined} value
 */
function validateMicrosoftClientId(value) {
	const clientId = value?.trim();
	if (!clientId) {
		throw new Error('MICROSOFT_CLIENT_ID is required when Microsoft auth is enabled.');
	}

	if (!isUuid(clientId)) {
		throw new Error('MICROSOFT_CLIENT_ID must be an Entra application client UUID.');
	}
}

/**
 * @param {string | undefined} value
 */
function validateMicrosoftClientSecret(value) {
	if (!value) {
		throw new Error('MICROSOFT_CLIENT_SECRET is required when Microsoft auth is enabled.');
	}

	if (value.trim() !== value || value.length < 16 || isPlaceholderSecret(value)) {
		throw new Error('MICROSOFT_CLIENT_SECRET must be a non-placeholder secret value.');
	}
}

/**
 * @param {string | undefined} value
 */
function validateMicrosoftAllowedDomains(value) {
	const domains = parseCommaSeparated(value);
	if (domains.length === 0) {
		throw new Error('MICROSOFT_ALLOWED_DOMAINS must include at least one allowed domain.');
	}

	for (const domain of domains) {
		if (!isDomainName(domain) || domain.startsWith('*.')) {
			throw new Error('MICROSOFT_ALLOWED_DOMAINS must contain comma-separated bare domains.');
		}
	}
}

/**
 * @param {string | undefined} value
 */
function validateMicrosoftAdminEmails(value) {
	const emails = parseCommaSeparated(value);
	if (emails.length === 0) {
		throw new Error('MICROSOFT_ADMIN_EMAILS must include at least one admin email.');
	}

	for (const email of emails) {
		if (!isEmailAddress(email)) {
			throw new Error('MICROSOFT_ADMIN_EMAILS must contain comma-separated email addresses.');
		}
	}
}

/**
 * @param {string | undefined} value
 * @param {boolean} allowInsecureLocalHttp
 */
function validateMicrosoftRedirectUri(value, allowInsecureLocalHttp) {
	if (!value?.trim()) return;

	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('MICROSOFT_REDIRECT_URI must be an absolute URL.');
	}

	const isLocalHttp =
		url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (url.protocol !== 'https:' && (!isLocalHttp || !allowInsecureLocalHttp)) {
		throw new Error('MICROSOFT_REDIRECT_URI must use HTTPS outside local development.');
	}

	if (url.hash) {
		throw new Error('MICROSOFT_REDIRECT_URI must not include a fragment.');
	}
}

/**
 * @param {string | undefined} value
 */
function validateMicrosoftScopes(value) {
	if (!value?.trim()) return;

	const scopes = value
		.split(/[,\s]+/)
		.map((scope) => scope.trim())
		.filter(Boolean);
	if (!scopes.includes('openid')) {
		throw new Error('MICROSOFT_SCOPES must include openid.');
	}
}

/**
 * @param {string} value
 */
function isStrongProductionSecret(value) {
	if (Buffer.byteLength(value, 'utf8') < 32) return false;
	if (value.trim() !== value) return false;

	const lower = value.toLowerCase();
	if (
		[
			'app-secret',
			'change-me',
			'changeme',
			'credential-master-key',
			'development',
			'password',
			'secret',
			'test-master-key',
			'termkit'
		].some((placeholder) => lower.includes(placeholder))
	) {
		return false;
	}

	if (new Set(value).size < 8) return false;
	return !isRepeatedPattern(value);
}

/**
 * @param {string} value
 */
function isPlaceholderSecret(value) {
	const lower = value.toLowerCase();
	return ['change-me', 'changeme', 'client-secret', 'microsoft-client-secret'].some((placeholder) =>
		lower.includes(placeholder)
	);
}

/**
 * @param {string} value
 */
function isRepeatedPattern(value) {
	for (let size = 1; size <= 8 && size <= value.length / 2; size += 1) {
		if (value.length % size === 0 && value.slice(0, size).repeat(value.length / size) === value) {
			return true;
		}
	}

	return false;
}

/**
 * @param {string} hostname
 */
function isInternalGatewayHostname(hostname) {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return (
		normalized === 'gateway' ||
		normalized === 'localhost' ||
		normalized === '0.0.0.0' ||
		normalized === '::' ||
		normalized === '::1' ||
		/^127(?:\.\d{1,3}){3}$/.test(normalized)
	);
}

/**
 * @param {string | undefined} value
 */
function parseCommaSeparated(value) {
	return (
		value
			?.split(',')
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean) ?? []
	);
}

/**
 * @param {string} value
 */
function isUuid(value) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * @param {string} value
 */
function isDomainName(value) {
	if (value.length > 253 || value.includes('..') || value.includes('/')) return false;
	return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

/**
 * @param {string} value
 */
function isEmailAddress(value) {
	const [localPart, domain, ...extra] = value.split('@');
	return extra.length === 0 && Boolean(localPart) && Boolean(domain) && isDomainName(domain);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedPath === fileURLToPath(import.meta.url)) {
	validateProductionEnv();
}
