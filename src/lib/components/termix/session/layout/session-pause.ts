export const sessionPauseStorageKey = 'termkit:session-pauses';

type SessionPauseStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export function sessionPauseKey(hostId: string, protocol: string) {
	return `termix-session:${hostId}:${protocol}`;
}

export function readSessionPauseKeys(storage: SessionPauseStorage): string[] {
	try {
		const parsed = JSON.parse(storage.getItem(sessionPauseStorageKey) ?? '[]');
		return Array.isArray(parsed)
			? [...new Set(parsed.filter((value): value is string => typeof value === 'string'))]
			: [];
	} catch {
		return [];
	}
}

export function persistSessionPause(
	storage: SessionPauseStorage,
	hostId: string,
	protocol: string
) {
	const key = sessionPauseKey(hostId, protocol);
	const next = [...new Set([...readSessionPauseKeys(storage), key])];
	writeSessionPauseKeys(storage, next);
	return next;
}

export function clearSessionPause(storage: SessionPauseStorage, hostId: string, protocol: string) {
	const key = sessionPauseKey(hostId, protocol);
	const next = readSessionPauseKeys(storage).filter((entry) => entry !== key);
	writeSessionPauseKeys(storage, next);
	return next;
}

export function isSessionPaused(keys: string[], hostId: string, protocol: string) {
	return keys.includes(sessionPauseKey(hostId, protocol));
}

function writeSessionPauseKeys(storage: SessionPauseStorage, keys: string[]) {
	if (keys.length === 0) {
		storage.removeItem(sessionPauseStorageKey);
		return;
	}
	storage.setItem(sessionPauseStorageKey, JSON.stringify(keys));
}
