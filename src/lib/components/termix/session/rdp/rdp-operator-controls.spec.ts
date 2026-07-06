import { describe, expect, it } from 'vitest';
import {
	applyRdpDisplayPreset,
	classifyRdpFailure,
	defaultRdpClipboardPolicy,
	normalizeDesktopDimension,
	normalizeRdpClipboardPolicy,
	rdpDisplayPresets
} from './rdp-operator-controls';

describe('RDP operator controls', () => {
	it('enables file clipboard by default while respecting legacy clipboard sync', () => {
		expect(defaultRdpClipboardPolicy.files).toBe(true);
		expect(normalizeRdpClipboardPolicy(undefined, true)).toMatchObject({
			text: true,
			files: true,
			clientToRemote: true,
			remoteToClient: true
		});
		expect(normalizeRdpClipboardPolicy(undefined, false)).toMatchObject({
			text: false,
			files: false,
			clientToRemote: false,
			remoteToClient: false
		});
	});

	it('caps display size by quality preset while preserving supported resize dimensions', () => {
		const performanceSize = applyRdpDisplayPreset({ width: 3200, height: 1800 }, 'performance');
		expect(performanceSize.width).toBeLessThanOrEqual(
			rdpDisplayPresets.performance.maxDesktop.width
		);
		expect(performanceSize.height).toBeLessThanOrEqual(
			rdpDisplayPresets.performance.maxDesktop.height
		);
		expect(performanceSize.width % 2).toBe(0);
		expect(performanceSize.width / performanceSize.height).toBeCloseTo(3200 / 1800, 2);
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
		expect(classifyRdpFailure('Could not create RDP launch', { phase: 'connect' })).toMatchObject({
			kind: 'gateway-expired',
			code: 'rdp_launch_failed',
			title: 'RDP launch failed',
			reconnectLabel: 'Retry RDP'
		});
		expect(classifyRdpFailure('Devolutions Gateway app-token failed')).toMatchObject({
			kind: 'gateway-expired',
			code: 'rdp_gateway_failed',
			title: 'Gateway session failed',
			reconnectLabel: 'Retry Gateway'
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
