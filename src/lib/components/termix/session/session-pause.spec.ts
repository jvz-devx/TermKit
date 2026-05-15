import { describe, expect, it } from 'vitest';
import {
	clearSessionPause,
	isSessionPaused,
	persistSessionPause,
	readSessionPauseKeys,
	sessionPauseStorageKey
} from './session-pause';

describe('session pause persistence', () => {
	it('persists intentional SSH closes across reloads until explicitly cleared', () => {
		const storage = memoryStorage();

		expect(persistSessionPause(storage, 'host-1', 'ssh')).toEqual(['termix-session:host-1:ssh']);
		expect(persistSessionPause(storage, 'host-1', 'ssh')).toEqual(['termix-session:host-1:ssh']);
		expect(readSessionPauseKeys(storage)).toEqual(['termix-session:host-1:ssh']);
		expect(isSessionPaused(readSessionPauseKeys(storage), 'host-1', 'ssh')).toBe(true);

		expect(clearSessionPause(storage, 'host-1', 'ssh')).toEqual([]);
		expect(storage.getItem(sessionPauseStorageKey)).toBeNull();
		expect(isSessionPaused(readSessionPauseKeys(storage), 'host-1', 'ssh')).toBe(false);
	});

	it('ignores corrupt persisted pause state', () => {
		const storage = memoryStorage();
		storage.setItem(sessionPauseStorageKey, 'not-json');

		expect(readSessionPauseKeys(storage)).toEqual([]);
	});
});

function memoryStorage(): Pick<Storage, 'getItem' | 'removeItem' | 'setItem'> {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		removeItem: (key) => values.delete(key),
		setItem: (key, value) => values.set(key, value)
	};
}
