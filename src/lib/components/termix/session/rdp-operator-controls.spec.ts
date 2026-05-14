import { describe, expect, it } from 'vitest';
import {
	applyRdpDisplayPreset,
	classifyRdpFailure,
	normalizeDesktopDimension,
	normalizeRdpClipboardPolicy,
	rdpDisplayPresets
} from './rdp-operator-controls';

describe('RDP operator controls', () => {
	it('caps display size by quality preset while preserving supported resize dimensions', () => {
		expect(applyRdpDisplayPreset({ width: 3200, height: 1800 }, 'performance')).toEqual({
			width: rdpDisplayPresets.performance.maxDesktop.width,
			height: rdpDisplayPresets.performance.maxDesktop.height
		});
		expect(applyRdpDisplayPreset({ width: 3200, height: 1800 }, 'quality')).toEqual({
			width: 3200,
			height: 1800
		});
		expect(normalizeDesktopDimension(1439, 2, 7680, true)).toBe(1438);
	});

	it('normalizes disabled clipboard payloads to disabled directions', () => {
		expect(
			normalizeRdpClipboardPolicy(
				{
					text: false,
					files: false,
					clientToRemote: true,
					remoteToClient: true,
					fileTransferSizeLimitMiB: 16
				},
				true
			)
		).toMatchObject({
			text: false,
			files: false,
			clientToRemote: false,
			remoteToClient: false
		});
	});

	it('classifies reconnect states operators need to act on', () => {
		expect(classifyRdpFailure('association token expired', { phase: 'connect' })).toMatchObject({
			kind: 'gateway-expired',
			code: 'rdp_gateway_expired',
			reconnectLabel: 'Reconnect'
		});
		expect(classifyRdpFailure('Logon failure', { phase: 'connect' })).toMatchObject({
			kind: 'credential-failure',
			code: 'rdp_credential_failed',
			reconnectLabel: 'Retry credentials'
		});
		expect(classifyRdpFailure('remote closed', { phase: 'run' })).toMatchObject({
			kind: 'remote-disconnect',
			code: 'rdp_remote_disconnected'
		});
		expect(classifyRdpFailure(new Error('wasm panic'), { phase: 'client' })).toMatchObject({
			kind: 'client-error',
			code: 'rdp_client_wasm_panic'
		});
	});
});
