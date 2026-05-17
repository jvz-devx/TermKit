import { describe, expect, it } from 'vitest';
import { sessionUrl, toWebSocketUrl } from './session-workspace-navigation';

describe('session workspace navigation helpers', () => {
	it('builds sessions URLs with optional query strings', () => {
		expect(sessionUrl(new URLSearchParams())).toBe('/sessions');
		expect(sessionUrl(new URLSearchParams([['host', 'h1']]))).toBe('/sessions?host=h1');
	});

	it('builds websocket URLs from browser location parts', () => {
		expect(toWebSocketUrl('/ws', { protocol: 'https:', host: 'example.test' })).toBe(
			'wss://example.test/ws'
		);
		expect(toWebSocketUrl('/ws', { protocol: 'http:', host: 'localhost:5173' })).toBe(
			'ws://localhost:5173/ws'
		);
	});
});
