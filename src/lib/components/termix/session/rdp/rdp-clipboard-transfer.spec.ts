import { describe, expect, it } from 'vitest';
import {
	createClipboardTelemetry,
	fileExceedsClipboardPolicy,
	formatBytes,
	nextClipboardTelemetry
} from './rdp-clipboard-transfer';

describe('RDP clipboard transfer helpers', () => {
	it('creates timestamped telemetry entries and keeps the newest items', () => {
		const entry = createClipboardTelemetry(
			{
				direction: 'client-to-remote',
				kind: 'file',
				status: 'complete',
				detail: 'done'
			},
			new Date('2026-01-02T03:04:05.000Z')
		);

		expect(entry.at).toBe('2026-01-02T03:04:05.000Z');
		expect(nextClipboardTelemetry([entry, entry], entry, 2)).toHaveLength(2);
	});

	it('formats byte sizes for clipboard status messages', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MiB');
		expect(formatBytes(12 * 1024 * 1024)).toBe('12 MiB');
	});

	it('checks file size policy limits', () => {
		expect(fileExceedsClipboardPolicy(new File(['a'], 'small.txt'), 1)).toBe(false);
		expect(
			fileExceedsClipboardPolicy(new File([new Uint8Array(2 * 1024 * 1024)], 'big.bin'), 1)
		).toBe(true);
	});
});
