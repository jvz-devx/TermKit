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

	it('allows explicitly opted-in local http Gateway public URLs', () => {
		expect(() =>
			validateProductionEnv(
				productionEnv({
					GATEWAY_PUBLIC_URL: 'http://localhost:3000/gateway',
					TERMIXKIT_INSECURE_LOCAL_HTTP: 'true'
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
			validateProductionEnv({
				NODE_ENV: 'production',
				ORIGIN: 'https://termix.example',
				APP_SECRET: 'd4YmG5uVPKHLb4xikqu47GzDL8RQXmyC4k53YmgW'
			})
		).toThrow('CREDENTIAL_MASTER_KEY is required in production');
	});

	it('requires a high-entropy app secret in production', () => {
		expect(() =>
			validateProductionEnv(
				productionEnv({
					APP_SECRET: ''
				})
			)
		).toThrow('APP_SECRET is required in production');

		expect(() =>
			validateProductionEnv(
				productionEnv({
					APP_SECRET: 'app-secret-app-secret-app-secret-app-secret'
				})
			)
		).toThrow('APP_SECRET must be at least 32 bytes and high-entropy');
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

	it('requires production Gateway provisioning configuration at startup', () => {
		expect(() =>
			validateProductionEnv(
				productionEnv({
					GATEWAY_URL: ''
				})
			)
		).toThrow('GATEWAY_URL is required in production');

		expect(() =>
			validateProductionEnv(
				productionEnv({
					GATEWAY_PROVISIONER_KEY: ''
				})
			)
		).toThrow('GATEWAY_PROVISIONER_KEY is required in production');
	});

	it('requires a secure browser-reachable Gateway public URL in production', () => {
		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'https://termix.example',
					GATEWAY_PUBLIC_URL: ''
				})
			)
		).toThrow('GATEWAY_PUBLIC_URL is required in production');

		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'https://termix.example',
					GATEWAY_PUBLIC_URL: 'http://rdp.example/gateway'
				})
			)
		).toThrow('GATEWAY_PUBLIC_URL must use https:// in production');

		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'https://termix.example',
					GATEWAY_PUBLIC_URL: 'http://rdp.example/gateway',
					TERMIXKIT_INSECURE_LOCAL_HTTP: '1'
				})
			)
		).toThrow('only permits local');

		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'https://termix.example',
					GATEWAY_PUBLIC_URL: 'https://gateway/gateway'
				})
			)
		).toThrow('GATEWAY_PUBLIC_URL must be browser-reachable in production');

		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'https://termix.example',
					GATEWAY_PUBLIC_URL: 'https://rdp.example'
				})
			)
		).toThrow('GATEWAY_PUBLIC_URL must use the app /gateway proxy path');

		expect(() =>
			validateProductionEnv(
				productionEnv({
					ORIGIN: 'https://termix.example',
					GATEWAY_PUBLIC_URL: 'https://rdp.example/gateway/custom'
				})
			)
		).toThrow('GATEWAY_PUBLIC_URL must use the app /gateway proxy path');
	});
});

function productionEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
	return {
		NODE_ENV: 'production',
		ORIGIN: 'https://termix.example',
		APP_SECRET: 'd4YmG5uVPKHLb4xikqu47GzDL8RQXmyC4k53YmgW',
		CREDENTIAL_MASTER_KEY: 'v6iJdWKrREfzCd9vxRSYKSBQg35bNyamzsUGq2VL',
		GATEWAY_URL: 'http://gateway:7171',
		GATEWAY_PUBLIC_URL: 'https://rdp.example/gateway',
		GATEWAY_PROVISIONER_KEY: 'shared-key',
		...overrides
	};
}
