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
			'GATEWAY_URL is required for RDP launches; GATEWAY_PROVISIONER_KEY is required for RDP launches'
		);
	});

	it('provisions a Devolutions Gateway app token and RDP association token', async () => {
		expect.assertions(8);
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const bootstrapper = new RdpGatewayBootstrapper(
			loadRdpGatewayConfig({
				GATEWAY_URL: 'http://gateway:7171',
				GATEWAY_PUBLIC_URL: 'https://rdp.example.test',
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
			gatewayPublicUrl: 'https://rdp.example.test',
			associationToken: 'association-token',
			preconnectionBlob: 'association-token',
			identity: {
				username: 'rdp-user',
				domain: null
			}
		});
		expect(bootstrap.credential).toEqual({
			kind: 'password',
			username: 'rdp-user',
			password: 'secret'
		});
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
		}
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
