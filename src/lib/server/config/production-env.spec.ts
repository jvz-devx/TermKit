import { describe, expect, it } from 'vitest';
import { validateProductionEnv } from '../../../../scripts/validate-production-env.mjs';

describe('production environment validation', () => {
	it('allows https production origins', () => {
		expect(() =>
			validateProductionEnv({ NODE_ENV: 'production', ORIGIN: 'https://termix.example' })
		).not.toThrow();
	});

	it('rejects http production origins without the local opt-in flag', () => {
		expect(() =>
			validateProductionEnv({ NODE_ENV: 'production', ORIGIN: 'http://localhost:3000' })
		).toThrow('ORIGIN must use https:// in production');
	});

	it('allows explicitly opted-in local http origins', () => {
		expect(() =>
			validateProductionEnv({
				NODE_ENV: 'production',
				ORIGIN: 'http://127.0.0.1:3000',
				TERMIXKIT_INSECURE_LOCAL_HTTP: '1'
			})
		).not.toThrow();
	});

	it('rejects insecure non-local origins even with the local flag', () => {
		expect(() =>
			validateProductionEnv({
				NODE_ENV: 'production',
				ORIGIN: 'http://termix.example',
				TERMIXKIT_INSECURE_LOCAL_HTTP: '1'
			})
		).toThrow('only permits local');
	});
});
