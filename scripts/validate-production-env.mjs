import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function validateProductionEnv(env = process.env) {
	if (env.NODE_ENV !== 'production') return;

	const origin = parseOrigin(env.ORIGIN);
	const allowInsecureLocalHttp = isEnabled(env.TERMIXKIT_INSECURE_LOCAL_HTTP);

	validateAppSecret(env.APP_SECRET);
	validateCredentialMasterKey(env.CREDENTIAL_MASTER_KEY);
	validateGatewayUrl(env.GATEWAY_URL);
	validateGatewayPublicUrl(env.GATEWAY_PUBLIC_URL, allowInsecureLocalHttp);
	validateGatewayProvisionerKey(env.GATEWAY_PROVISIONER_KEY);

	if (origin.protocol === 'https:') return;

	if (!allowInsecureLocalHttp) {
		throw new Error(
			'ORIGIN must use https:// in production. For direct local HTTP only, set TERMIXKIT_INSECURE_LOCAL_HTTP=1.'
		);
	}

	if (origin.protocol !== 'http:' || !isLocalHostname(origin.hostname)) {
		throw new Error(
			'TERMIXKIT_INSECURE_LOCAL_HTTP=1 only permits local http://localhost or loopback ORIGIN values.'
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
				'GATEWAY_PUBLIC_URL must use https:// in production. For direct local HTTP only, set TERMIXKIT_INSECURE_LOCAL_HTTP=1.'
			);
		}

		if (url.protocol !== 'http:' || !isLocalHostname(url.hostname)) {
			throw new Error(
				'TERMIXKIT_INSECURE_LOCAL_HTTP=1 only permits local http://localhost or loopback GATEWAY_PUBLIC_URL values.'
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
			'termixkit'
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

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedPath === fileURLToPath(import.meta.url)) {
	validateProductionEnv();
}
