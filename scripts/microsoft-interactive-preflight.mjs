import { writeFileSync } from 'node:fs';

const requiredEnv = [
	'MICROSOFT_AUTH_ENABLED',
	'MICROSOFT_TENANT_ID',
	'MICROSOFT_CLIENT_ID',
	'MICROSOFT_CLIENT_SECRET',
	'MICROSOFT_ALLOWED_DOMAINS',
	'MICROSOFT_ADMIN_EMAILS'
];
const enabledValues = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const domainPattern =
	/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const options = parseArgs(process.argv.slice(2));

if (options.help) {
	printHelp();
	process.exit(0);
}

const result = preflight(process.env);
if (result.errors.length > 0) {
	console.error('Microsoft interactive acceptance preflight is not ready:');
	for (const error of result.errors) console.error(`- ${error}`);
	if (options.notesTemplate) writeNotesTemplate(options.notesTemplate, result);
	process.exit(2);
}

console.log('Microsoft interactive acceptance preflight is ready.');
console.log(`Required environment: ${requiredEnv.length}/${requiredEnv.length} present`);
console.log(`Redirect URI: ${result.redirectUri}`);
console.log(`Microsoft login URL: ${result.origin}/auth/microsoft/login`);
console.log(`Local login URL: ${result.origin}/login`);
console.log(`Allowed domains configured: ${result.allowedDomains.length}`);
console.log(`Admin emails configured: ${result.adminEmails.length}`);

if (options.notesTemplate) writeNotesTemplate(options.notesTemplate, result);

function preflight(env) {
	const errors = [];
	const missing = requiredEnv.filter((name) => !envValue(env, name));
	if (missing.length > 0) errors.push(`missing environment variable(s): ${missing.join(', ')}`);

	if (!isEnabled(env.MICROSOFT_AUTH_ENABLED)) {
		errors.push('MICROSOFT_AUTH_ENABLED must be truthy for the browser proof run');
	}

	const tenantId = envValue(env, 'MICROSOFT_TENANT_ID');
	if (tenantId && !isTenantId(tenantId)) {
		errors.push('MICROSOFT_TENANT_ID must be a tenant UUID or verified tenant domain');
	}

	const allowedDomains = parseCsv(envValue(env, 'MICROSOFT_ALLOWED_DOMAINS'));
	if (allowedDomains.length === 0) {
		errors.push('MICROSOFT_ALLOWED_DOMAINS must contain at least one domain');
	}
	for (const domain of allowedDomains) {
		if (!isEmailDomain(domain)) errors.push('MICROSOFT_ALLOWED_DOMAINS must contain bare domains');
	}

	const adminEmails = parseCsv(envValue(env, 'MICROSOFT_ADMIN_EMAILS'));
	if (adminEmails.length === 0) {
		errors.push('MICROSOFT_ADMIN_EMAILS must contain at least one email address');
	}
	for (const email of adminEmails) {
		if (!isEmailAddress(email)) errors.push('MICROSOFT_ADMIN_EMAILS must contain email addresses');
	}

	const scopes = parseScopes(envValue(env, 'MICROSOFT_SCOPES'));
	if (!scopes.includes('openid')) errors.push('MICROSOFT_SCOPES must include openid');
	if (scopes.some((scope) => [...scope].some((char) => char.charCodeAt(0) <= 32))) {
		errors.push('MICROSOFT_SCOPES must contain valid scope names');
	}

	const origin = envValue(env, 'ORIGIN');
	const redirectUri =
		envValue(env, 'MICROSOFT_REDIRECT_URI') ?? (origin ? callbackFromOrigin(origin) : null);
	if (!redirectUri) errors.push('ORIGIN or MICROSOFT_REDIRECT_URI is required');

	const originResult = parseOrigin(origin, redirectUri);
	if (originResult.error) errors.push(originResult.error);
	const redirectError = redirectUri ? validateRedirectUri(redirectUri) : null;
	if (redirectError) errors.push(redirectError);

	return {
		errors,
		allowedDomains,
		adminEmails,
		origin: originResult.origin,
		redirectUri
	};
}

function writeNotesTemplate(path, result) {
	const template = `TODO replace every TODO line before recording proof. The final notes must include the exact audit fragments listed in README.
TODO allowed domain user: replace with redacted proof that an allowed Microsoft user signed in and received a TermixKit session at ${result.origin ?? '<origin>'}.
TODO blocked external domain user: replace with redacted proof that a user outside MICROSOFT_ALLOWED_DOMAINS was denied.
TODO configured admin email user: replace with redacted proof that a MICROSOFT_ADMIN_EMAILS user provisioned or was promoted as admin.
TODO local username password login: replace with redacted proof that username/password login still works after Microsoft auth is enabled.
`;
	writeFileSync(path, template);
	console.log(`Wrote Microsoft interactive notes template to ${path}.`);
}

function parseArgs(args) {
	const parsed = { help: false };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--help' || arg === '-h') {
			parsed.help = true;
		} else if (arg === '--notes-template') {
			parsed.notesTemplate = requireValue(args, (index += 1), arg);
		} else if (arg.startsWith('--notes-template=')) {
			parsed.notesTemplate = arg.slice('--notes-template='.length);
		} else {
			console.error(`Unknown argument: ${arg}`);
			printHelp();
			process.exit(1);
		}
	}

	return parsed;
}

function requireValue(args, index, flag) {
	const value = args[index]?.trim();
	if (!value) {
		console.error(`${flag} requires a value.`);
		process.exit(1);
	}
	return value;
}

function envValue(env, key) {
	const value = env[key]?.trim();
	return value ? value : null;
}

function isEnabled(value) {
	return enabledValues.has(value?.trim().toLowerCase() ?? '');
}

function parseCsv(value) {
	return (
		value
			?.split(',')
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean) ?? []
	);
}

function parseScopes(value) {
	if (!value) return ['openid', 'profile', 'email'];
	return Array.from(
		new Set(
			value
				.split(/[,\s]+/)
				.map((scope) => scope.trim())
				.filter(Boolean)
		)
	);
}

function isTenantId(value) {
	return uuidPattern.test(value) || domainPattern.test(value);
}

function isEmailDomain(value) {
	return domainPattern.test(value) && !value.startsWith('*.') && !value.includes('/');
}

function isEmailAddress(value) {
	const [localPart, domain, ...extra] = value.split('@');
	return extra.length === 0 && Boolean(localPart) && Boolean(domain) && isEmailDomain(domain);
}

function callbackFromOrigin(origin) {
	try {
		return `${new URL(origin).origin}/auth/microsoft/callback`;
	} catch {
		return null;
	}
}

function parseOrigin(origin, redirectUri) {
	const fallbackOrigin = redirectUri ? safeUrlOrigin(redirectUri) : null;
	if (!origin) return { origin: fallbackOrigin ?? '<origin>', error: null };

	try {
		return { origin: new URL(origin).origin, error: null };
	} catch {
		return { origin: fallbackOrigin ?? '<origin>', error: 'ORIGIN must be an absolute URL' };
	}
}

function safeUrlOrigin(value) {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function validateRedirectUri(value) {
	let url;
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
	if (url.pathname !== '/auth/microsoft/callback') {
		return 'MICROSOFT_REDIRECT_URI must use /auth/microsoft/callback';
	}
	return null;
}

function printHelp() {
	console.log(`Usage: npm run acceptance:microsoft-interactive-preflight -- [options]

Checks that the local environment is ready for the manual Microsoft interactive
browser proof without printing tenant secrets or client credentials.

Options:
  --notes-template PATH   Write a redacted notes template for the proof recorder
  -h, --help              Show this help
`);
}
