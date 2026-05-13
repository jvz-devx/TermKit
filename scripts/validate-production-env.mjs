import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function validateProductionEnv(env = process.env) {
	if (env.NODE_ENV !== 'production') return;

	const origin = parseOrigin(env.ORIGIN);
	const allowInsecureLocalHttp = isEnabled(env.TERMIXKIT_INSECURE_LOCAL_HTTP);

	validateCredentialMasterKey(env.CREDENTIAL_MASTER_KEY);

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
	return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * @param {string | undefined} masterKey
 */
function validateCredentialMasterKey(masterKey) {
	if (!masterKey) {
		throw new Error('CREDENTIAL_MASTER_KEY is required in production.');
	}

	if (!isStrongCredentialMasterKey(masterKey)) {
		throw new Error(
			'CREDENTIAL_MASTER_KEY must be at least 32 bytes and high-entropy in production.'
		);
	}
}

/**
 * @param {string} masterKey
 */
function isStrongCredentialMasterKey(masterKey) {
	if (Buffer.byteLength(masterKey, 'utf8') < 32) return false;
	if (masterKey.trim() !== masterKey) return false;

	const lower = masterKey.toLowerCase();
	if (
		[
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

	if (new Set(masterKey).size < 8) return false;
	return !isRepeatedPattern(masterKey);
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

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedPath === fileURLToPath(import.meta.url)) {
	validateProductionEnv();
}
