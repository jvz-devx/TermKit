import { describe, expect, it, vi } from 'vitest';
import {
	appendTerminalRecordingFrame,
	buildTerminalRecordingCast,
	createTerminalRecordingId,
	pruneTerminalRecordingMetadata,
	rememberTerminalRecording,
	terminalRecordingBytes,
	terminalRecordingExpiresAt
} from './terminal-recording';

describe('terminal recording helpers', () => {
	it('keeps recording disabled until frames are explicitly appended', () => {
		vi.setSystemTime(new Date('2026-05-14T12:00:05.000Z'));
		const frames = appendTerminalRecordingFrame(
			[],
			Date.parse('2026-05-14T12:00:00.000Z'),
			'uptime\n'
		);

		expect(frames).toEqual([{ at: 5, data: 'uptime\n' }]);
		expect(terminalRecordingBytes(frames)).toBe(7);
		expect(createTerminalRecordingId(new Date('2026-05-14T12:00:00.000Z'))).toBe(
			'terminal-20260514120000'
		);

		vi.useRealTimers();
	});

	it('builds asciicast output outside connection metadata', async () => {
		const blob = buildTerminalRecordingCast({
			width: 120,
			height: 32,
			startedAt: new Date('2026-05-14T12:00:00.000Z'),
			title: 'prod shell',
			frames: [{ at: 0.25, data: 'hello' }]
		});

		await expect(blob.text()).resolves.toContain('"version":2');
		await expect(blob.text()).resolves.toContain('[0.25,"o","hello"]');
	});

	it('prunes retained metadata after expiry', () => {
		const storage = memoryStorage();
		const startedAt = new Date('2026-05-14T12:00:00.000Z');
		rememberTerminalRecording(storage, {
			id: 'recording-1',
			title: 'prod shell',
			startedAt: startedAt.toISOString(),
			endedAt: startedAt.toISOString(),
			expiresAt: terminalRecordingExpiresAt(startedAt, 7).toISOString(),
			bytes: 12
		});

		expect(
			pruneTerminalRecordingMetadata(storage, new Date('2026-05-15T12:00:00.000Z'))
		).toHaveLength(1);
		expect(pruneTerminalRecordingMetadata(storage, new Date('2026-05-22T12:00:01.000Z'))).toEqual(
			[]
		);
	});
});

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
	const values = new Map<string, string>();
	return {
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, value);
		}
	};
}
