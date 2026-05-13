import { describe, expect, it } from 'vitest';
import {
	loadRdpGatewayConfig,
	RdpGatewayBootstrapper,
	RdpGatewayConfigurationError,
	RdpGatewayProvisioningError
} from './gateway';
import type { ConsumedTicket } from '$lib/server/protocols';

describe('RDP Gateway bootstrap', () => {
	it('surfaces missing Gateway configuration', () => {
		expect(() => loadRdpGatewayConfig({})).toThrow(RdpGatewayConfigurationError);
		expect(() => loadRdpGatewayConfig({})).toThrow(
			'GATEWAY_URL is required for RDP launches; GATEWAY_PUBLIC_URL is required for browser RDP launches; GATEWAY_PROVISIONER_KEY is required for RDP launches'
		);
	});

	it('requires a secure browser-reachable Gateway public URL in production', () => {
		expect(() =>
			loadRdpGatewayConfig({
				NODE_ENV: 'production',
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'http://rdp.example.test/gateway',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			})
		).toThrow('GATEWAY_PUBLIC_URL must use https:// in production');

		expect(() =>
			loadRdpGatewayConfig({
				NODE_ENV: 'production',
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'https://gateway/gateway',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			})
		).toThrow('GATEWAY_PUBLIC_URL must be browser-reachable in production');

		expect(() =>
			loadRdpGatewayConfig({
				NODE_ENV: 'production',
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'https://rdp.example.test',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			})
		).toThrow('GATEWAY_PUBLIC_URL must use the app /gateway proxy path');

		expect(() =>
			loadRdpGatewayConfig({
				NODE_ENV: 'production',
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'https://rdp.example.test/gateway/custom',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			})
		).toThrow('GATEWAY_PUBLIC_URL must use the app /gateway proxy path');
	});

	it('allows explicitly opted-in local http Gateway public URLs in production', () => {
		expect(() =>
			loadRdpGatewayConfig({
				NODE_ENV: 'production',
				TERMIXKIT_INSECURE_LOCAL_HTTP: '1',
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'http://localhost:3000/gateway',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			})
		).not.toThrow();
	});

	it('rejects invalid internal Gateway URLs', () => {
		expect(() =>
			loadRdpGatewayConfig({
				GATEWAY_URL: 'ftp://gateway',
				GATEWAY_PUBLIC_URL: 'https://rdp.example.test/gateway',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			})
		).toThrow('GATEWAY_URL must use http:// or https://');

		expect(() =>
			loadRdpGatewayConfig({
				GATEWAY_URL: 'http://user:pass@gateway:7171',
				GATEWAY_PUBLIC_URL: 'https://rdp.example.test/gateway',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			})
		).toThrow('GATEWAY_URL must not include credentials or fragments');
	});

	it('provisions a Devolutions Gateway app token and RDP association token', async () => {
		expect.assertions(9);
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const bootstrapper = new RdpGatewayBootstrapper(
			loadRdpGatewayConfig({
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'https://rdp.example.test/gateway',
				GATEWAY_PROVISIONER_KEY: 'shared-key',
				GATEWAY_PROVISIONER_SUBJECT: 'termix'
			}),
			async (url, init) => {
				calls.push({ url: String(url), init });
				return textResponse(calls.length === 1 ? 'app-token' : 'association-token');
			}
		);

		const bootstrap = await bootstrapper.bootstrap(testTicket());

		expect(bootstrap).toMatchObject({
			provider: 'devolutions-gateway',
			protocol: 'rdp',
			destination: 'tcp://windows.example.test:3389',
			gatewayUrl: 'http://gateway:7171',
			gatewayPublicUrl: 'https://rdp.example.test/gateway',
			associationToken: 'association-token',
			preconnectionBlob: 'association-token',
			identity: {
				username: 'rdp-user',
				domain: 'ACME'
			}
		});
		expect(bootstrap.credentialHint).toEqual({
			kind: 'password',
			username: 'rdp-user',
			serverHeld: true
		});
		expect(JSON.stringify(bootstrap)).not.toContain('secret');
		expect(calls).toHaveLength(2);
		expect(calls[0].url).toBe('http://gateway:7171/jet/webapp/app-token');
		expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
			`Basic ${Buffer.from('termix:shared-key').toString('base64')}`
		);
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			content_type: 'WEBAPP',
			subject: 'user-1'
		});
		expect(calls[1].url).toBe('http://gateway:7171/jet/webapp/session-token');
		expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
			content_type: 'ASSOCIATION',
			protocol: 'rdp',
			destination: 'tcp://windows.example.test:3389',
			lifetime: 60
		});
	});

	it('surfaces Gateway provisioning failures without claiming success', async () => {
		expect.assertions(2);
		const bootstrapper = new RdpGatewayBootstrapper(
			loadRdpGatewayConfig({
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'http://localhost:3000/gateway',
				GATEWAY_PROVISIONER_KEY: 'shared-key'
			}),
			async () => textResponse('gateway unavailable', false, 502, 'Bad Gateway')
		);

		await expect(bootstrapper.bootstrap(testTicket())).rejects.toBeInstanceOf(
			RdpGatewayProvisioningError
		);
		await expect(bootstrapper.bootstrap(testTicket())).rejects.toThrow(
			'Devolutions Gateway app-token failed (502 Bad Gateway): gateway unavailable'
		);
	});
});

function testTicket(): ConsumedTicket {
	return {
		ticketId: 'ticket-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'rdp',
		target: {
			host: 'windows.example.test',
			port: 3389,
			username: 'rdp-user',
			credential: {
				kind: 'password',
				username: 'rdp-user',
				password: 'secret'
			}
		},
		metadata: { domain: 'ACME' }
	};
}

function textResponse(text: string, ok = true, status = 200, statusText = 'OK') {
	return {
		ok,
		status,
		statusText,
		async text() {
			return text;
		}
	};
}
