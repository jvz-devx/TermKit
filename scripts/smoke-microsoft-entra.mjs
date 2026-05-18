import { createServer as createViteServer } from 'vite';

const results = [];
let viteServer;

class SkipSmoke extends Error {
	constructor(message) {
		super(message);
		this.name = 'SkipSmoke';
	}
}

try {
	const { parseMicrosoftEntraAuthConfig } = await loadMicrosoftModule();
	await runSmoke('Microsoft Entra configuration', () =>
		smokeMicrosoftConfig(parseMicrosoftEntraAuthConfig)
	);
	await runSmoke('Microsoft Entra discovery and JWKS', () =>
		smokeMicrosoftDiscovery(parseMicrosoftEntraAuthConfig)
	);
	await runSmoke('Microsoft Entra client credentials', () =>
		smokeMicrosoftClientCredentials(parseMicrosoftEntraAuthConfig)
	);

	for (const result of results) printResult(console.log, result);
} catch (error) {
	for (const result of results) printResult(console.error, result);
	console.error(error instanceof Error ? error.stack || error.message : error);
	process.exitCode = 1;
} finally {
	await viteServer?.close();
}

process.exit(process.exitCode ?? 0);

async function loadMicrosoftModule() {
	viteServer = await createViteServer({
		server: { middlewareMode: true },
		appType: 'custom',
		logLevel: 'error',
		optimizeDeps: {
			noDiscovery: true,
			entries: []
		}
	});

	return viteServer.ssrLoadModule('/src/lib/server/auth/microsoft.ts');
}

async function runSmoke(name, callback) {
	try {
		const detail = await withTimeout(callback(), name, readTimeoutMs());
		results.push({ status: '[pass]', name, detail });
	} catch (error) {
		if (error instanceof SkipSmoke) {
			results.push({ status: '[skip]', name, detail: error.message });
			return;
		}

		results.push({ status: '[fail]', name, detail: errorMessage(error) });
		throw error;
	}
}

function smokeMicrosoftConfig(parseMicrosoftEntraAuthConfig) {
	const result = parseMicrosoftEntraAuthConfig({
		MICROSOFT_AUTH_ENABLED: '1',
		MICROSOFT_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
		MICROSOFT_CLIENT_SECRET: 'client-secret',
		MICROSOFT_TENANT_ID: '22222222-2222-4222-8222-222222222222',
		MICROSOFT_ALLOWED_DOMAINS: 'example.com',
		MICROSOFT_ADMIN_EMAILS: 'admin@example.com',
		ORIGIN: 'https://termix.example'
	});

	assert(result.enabled, 'fixture Microsoft config did not parse as enabled');
	assert(
		result.config.redirectUri === 'https://termix.example/auth/microsoft/callback',
		'fixture Microsoft redirect URI mismatch'
	);
	assert(
		result.config.scopes.join(' ') === 'openid profile email',
		'fixture Microsoft scopes mismatch'
	);

	return 'validated parser fixture';
}

async function smokeMicrosoftDiscovery(parseMicrosoftEntraAuthConfig) {
	const config = realMicrosoftConfig(parseMicrosoftEntraAuthConfig);
	const discovery = await fetchJson(discoveryUrl(config.tenantId), 'Microsoft discovery document');
	const jwks = await fetchJson(config.jwksUri, 'Microsoft JWKS');

	assertUrl(discovery.authorization_endpoint, 'authorization_endpoint');
	assertUrl(discovery.token_endpoint, 'token_endpoint');
	assertUrl(discovery.jwks_uri, 'jwks_uri');
	assertMicrosoftEndpoint(
		config.authorizationEndpoint,
		discovery.authorization_endpoint,
		'authorize'
	);
	assertMicrosoftEndpoint(config.tokenEndpoint, discovery.token_endpoint, 'token');
	assertMicrosoftEndpoint(config.jwksUri, discovery.jwks_uri, 'keys');
	assert(
		discovery.authorization_endpoint.includes('/oauth2/v2.0/authorize'),
		'discovery authorization endpoint is not v2.0'
	);
	assert(
		discovery.token_endpoint.includes('/oauth2/v2.0/token'),
		'discovery token endpoint is not v2.0'
	);
	assert(Array.isArray(jwks.keys), 'Microsoft JWKS did not include a keys array');
	assert(jwks.keys.length > 0, 'Microsoft JWKS did not include signing keys');

	return `loaded Microsoft discovery and ${jwks.keys.length} JWKS keys`;
}

async function smokeMicrosoftClientCredentials(parseMicrosoftEntraAuthConfig) {
	const scope = process.env.TERMKIT_SMOKE_MICROSOFT_CLIENT_CREDENTIALS_SCOPE?.trim();
	if (!scope) {
		throw new SkipSmoke('missing TERMKIT_SMOKE_MICROSOFT_CLIENT_CREDENTIALS_SCOPE');
	}

	const config = realMicrosoftConfig(parseMicrosoftEntraAuthConfig);
	const response = await fetch(config.tokenEndpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			grant_type: 'client_credentials',
			scope
		})
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(
			`Microsoft client credentials exchange returned ${response.status}: ${payload.error_description ?? payload.error ?? '<no error>'}`
		);
	}

	assert(typeof payload.access_token === 'string' && payload.access_token, 'access token missing');
	assert(payload.token_type === 'Bearer', 'unexpected token type');
	return 'client credentials token issued';
}

function realMicrosoftConfig(parseMicrosoftEntraAuthConfig) {
	if (!isEnabled(process.env.MICROSOFT_AUTH_ENABLED)) {
		if (process.env.TERMKIT_SMOKE_MICROSOFT_REQUIRE_REAL === '1') {
			throw new Error('MICROSOFT_AUTH_ENABLED is required for real Microsoft smoke.');
		}
		throw new SkipSmoke('missing Microsoft Entra env');
	}

	const result = parseMicrosoftEntraAuthConfig(process.env);
	if (!result.enabled) {
		throw new Error(`Microsoft Entra env is invalid: ${result.errors.join('; ')}`);
	}
	return result.config;
}

function discoveryUrl(tenantId) {
	return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`;
}

async function fetchJson(url, label) {
	const response = await fetch(url);
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(`${label} returned ${response.status}`);
	}
	return payload;
}

function assertUrl(value, fieldName) {
	assert(typeof value === 'string' && URL.canParse(value), `${fieldName} is not an absolute URL`);
}

function assertMicrosoftEndpoint(configuredValue, discoveryValue, expectedLeaf) {
	const configured = new URL(configuredValue);
	const discovery = new URL(discoveryValue);
	assert(
		configured.origin === discovery.origin,
		`configured Microsoft ${expectedLeaf} endpoint origin did not match discovery`
	);
	assert(
		configured.hostname === 'login.microsoftonline.com',
		`configured Microsoft ${expectedLeaf} endpoint did not use login.microsoftonline.com`
	);
	assert(
		configured.pathname.endsWith(`/${expectedLeaf}`),
		`configured Microsoft ${expectedLeaf} endpoint path was unexpected`
	);
}

function isEnabled(value) {
	return ['1', 'true', 'yes', 'on', 'enabled'].includes(value?.trim().toLowerCase() ?? '');
}

async function withTimeout(promise, label, timeoutMs) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
			timeoutMs
		);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

function readTimeoutMs() {
	const value = process.env.TERMKIT_SMOKE_MICROSOFT_TIMEOUT_MS;
	if (!value) return 10_000;

	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120_000) {
		throw new Error('TERMKIT_SMOKE_MICROSOFT_TIMEOUT_MS must be an integer from 1000 to 120000');
	}
	return parsed;
}

function printResult(write, result) {
	const suffix = result.detail ? ` - ${result.detail}` : '';
	write(`${result.status} ${result.name}${suffix}`);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
