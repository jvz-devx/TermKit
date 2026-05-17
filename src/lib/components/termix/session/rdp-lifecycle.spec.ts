import { describe, expect, it } from 'vitest';
import { isGatewayExpired, lifecycleEventOnDispose } from './rdp-lifecycle';

describe('RDP lifecycle helpers', () => {
	it('detects expired gateway tokens', () => {
		expect(isGatewayExpired(null)).toBe(false);
		expect(isGatewayExpired('2026-01-01T00:00:00.000Z', Date.parse('2026-01-02T00:00:00.000Z'))).toBe(true);
		expect(isGatewayExpired('2026-01-03T00:00:00.000Z', Date.parse('2026-01-02T00:00:00.000Z'))).toBe(false);
	});

	it('maps dispose state to lifecycle events', () => {
		expect(lifecycleEventOnDispose('error')).toEqual({
			event: 'failed',
			errorCode: 'rdp_client_pane_abandoned_error'
		});
		expect(lifecycleEventOnDispose('connected')).toEqual({ event: 'ended' });
	});
});
