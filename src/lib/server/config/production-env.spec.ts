import { describe, expect, it } from 'vitest';
import { validateProductionEnv } from '../../../../scripts/validate-production-env.mjs';

describe('production environment validation', () => {
	it('allows https production origins', () => {
		expect(() =>
			validateProductionEnv(productionEnv({ ORIGIN: 'https://termix.example' }))
		).not.toThrow();
	});

	it('rejects http production origins without the local opt-in flag', () => {
		expect(() => validateProductionEnv(productionEnv({ ORIGIN: 'http://localhost:3000' }))).toThrow(
			'ORIGIN must use https:// in production'
		);
	});

	it('allows explicitly opted-in local http origins', () => {
		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'http://127.0.0.1:3000',
					TERMIXKIT_INSECURE_LOCAL_HTTP: '1'
				})
			)
		).not.toThrow();
	});

	it('rejects insecure non-local origins even with the local flag', () => {
		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'http://termix.example',
					TERMIXKIT_INSECURE_LOCAL_HTTP: '1'
				})
			)
		).toThrow('only permits local');
	});

	it('requires a production credential master key', () => {
		expect(() =>
			validateProductionEnv({ NODE_ENV: 'production', ORIGIN: 'https://termix.example' })
		).toThrow('CREDENTIAL_MASTER_KEY is required in production');
	});

	it('rejects weak production credential master keys', () => {
		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'https://termix.example',
					CREDENTIAL_MASTER_KEY: 'test-master-key-test-master-key-test'
				})
			)
		).toThrow('CREDENTIAL_MASTER_KEY must be at least 32 bytes and high-entropy');
	});
});

function productionEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
	return {
		NODE_ENV: 'production',
		CREDENTIAL_MASTER_KEY: 'v6iJdWKrREfzCd9vxRSYKSBQg35bNyamzsUGq2VL',
		...overrides
	};
}
