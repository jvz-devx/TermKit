export type TerminalRecordingFrame = {
	at: number;
	data: string;
};

export type StoredTerminalRecording = {
	id: string;
	title: string;
	startedAt: string;
	endedAt: string;
	expiresAt: string;
	bytes: number;
};

const metadataKey = 'termixkit:terminal-recordings';

export function createTerminalRecordingId(now = new Date()): string {
	return `terminal-${now
		.toISOString()
		.replace(/[^0-9]/g, '')
		.slice(0, 14)}`;
}

export function terminalRecordingExpiresAt(startedAt: Date, retentionDays: number): Date {
	const expiresAt = new Date(startedAt);
	expiresAt.setUTCDate(expiresAt.getUTCDate() + Math.max(1, Math.trunc(retentionDays)));
	return expiresAt;
}

export function appendTerminalRecordingFrame(
	frames: TerminalRecordingFrame[],
	startedAtMs: number,
	data: string | Uint8Array
): TerminalRecordingFrame[] {
	const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
	if (!text) return frames;
	return [...frames, { at: Math.max(0, (Date.now() - startedAtMs) / 1000), data: text }];
}

export function terminalRecordingBytes(frames: TerminalRecordingFrame[]): number {
	const encoder = new TextEncoder();
	return frames.reduce((total, frame) => total + encoder.encode(frame.data).byteLength, 0);
}

export function buildTerminalRecordingCast(input: {
	width: number;
	height: number;
	startedAt: Date;
	title: string;
	frames: TerminalRecordingFrame[];
}): Blob {
	const header = {
		version: 2,
		width: input.width,
		height: input.height,
		timestamp: Math.floor(input.startedAt.getTime() / 1000),
		title: input.title,
		env: { TERM: 'xterm-256color' }
	};
	const lines = [
		JSON.stringify(header),
		...input.frames.map((frame) => JSON.stringify([frame.at, 'o', frame.data]))
	];
	return new Blob([`${lines.join('\n')}\n`], { type: 'application/x-asciicast' });
}

export function rememberTerminalRecording(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	recording: StoredTerminalRecording
): StoredTerminalRecording[] {
	const recordings = pruneTerminalRecordingMetadata(storage, new Date(recording.endedAt));
	const next = [recording, ...recordings.filter((entry) => entry.id !== recording.id)].slice(0, 50);
	storage.setItem(metadataKey, JSON.stringify(next));
	return next;
}

export function pruneTerminalRecordingMetadata(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	now = new Date()
): StoredTerminalRecording[] {
	const recordings = readTerminalRecordingMetadata(storage).filter(
		(recording) => new Date(recording.expiresAt).getTime() > now.getTime()
	);
	storage.setItem(metadataKey, JSON.stringify(recordings));
	return recordings;
}

export function readTerminalRecordingMetadata(
	storage: Pick<Storage, 'getItem'>
): StoredTerminalRecording[] {
	const raw = storage.getItem(metadataKey);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? parsed.filter(isStoredTerminalRecording) : [];
	} catch {
		return [];
	}
}

function isStoredTerminalRecording(value: unknown): value is StoredTerminalRecording {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Partial<StoredTerminalRecording>;
	return (
		typeof record.id === 'string' &&
		typeof record.title === 'string' &&
		typeof record.startedAt === 'string' &&
		typeof record.endedAt === 'string' &&
		typeof record.expiresAt === 'string' &&
		typeof record.bytes === 'number'
	);
}
