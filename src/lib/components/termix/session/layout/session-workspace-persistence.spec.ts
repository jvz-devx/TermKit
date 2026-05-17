import { describe, expect, it } from 'vitest';
import {
	rememberedWorkspaceProtocol,
	rememberWorkspaceProtocol
} from './session-workspace-persistence';

describe('session workspace persistence helpers', () => {
	it('round-trips remembered protocols when enabled', () => {
		const storage = new Map<string, string>();
		const localStorage = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			}
		} as unknown as Storage;

		rememberWorkspaceProtocol({
			storage: localStorage,
			hostId: 'host-1',
			protocol: 'rdp',
			enabled: true
		});

		expect(
			rememberedWorkspaceProtocol({ storage: localStorage, hostId: 'host-1', enabled: true })
		).toBe('rdp');
	});

	it('ignores invalid, disabled, or missing storage values', () => {
		const storage = {
			getItem: () => 'http',
			setItem: () => undefined
		} as unknown as Storage;

		expect(rememberedWorkspaceProtocol({ storage, hostId: 'host-1', enabled: true })).toBeNull();
		expect(rememberedWorkspaceProtocol({ storage, hostId: 'host-1', enabled: false })).toBeNull();
		expect(
			rememberedWorkspaceProtocol({ storage: null, hostId: 'host-1', enabled: true })
		).toBeNull();
	});
});
