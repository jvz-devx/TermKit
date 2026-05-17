import { describe, expect, it } from 'vitest';
import {
	copyLocalFileToRemoteClipboard,
	createClipboardTelemetry,
	fileExceedsClipboardPolicy,
	formatBytes,
	nextClipboardTelemetry,
	saveRemoteClipboardToBrowser,
	type RdpClipboardData,
	type RdpFileTransferUpdate
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

	it('runs local file copy updates around the RDP clipboard paste', async () => {
		const updates: RdpFileTransferUpdate[] = [];
		const clipboardData = createFakeClipboardData();

		await copyLocalFileToRemoteClipboard({
			file: new File(['payload'], 'payload.txt', { type: 'text/plain' }),
			limitMiB: 1,
			createClipboardData: () => clipboardData,
			paste: async (content) => {
				expect(content).toBe(clipboardData);
			},
			onUpdate: (update) => updates.push(update)
		});

		expect(updates.map((update) => update.state)).toEqual(['copying', 'complete']);
		expect(clipboardData.text).toEqual([['text/plain', 'payload.txt']]);
		expect(clipboardData.binary[0]?.[0]).toBe('text/plain');
		expect(clipboardData.freed).toBe(true);
	});

	it('reports failed local file copy when the policy limit is exceeded', async () => {
		const updates: RdpFileTransferUpdate[] = [];

		await copyLocalFileToRemoteClipboard({
			file: new File([new Uint8Array(2 * 1024 * 1024)], 'big.bin'),
			limitMiB: 1,
			createClipboardData: () => createFakeClipboardData(),
			paste: async () => {
				throw new Error('should not paste');
			},
			onUpdate: (update) => updates.push(update)
		});

		expect(updates).toHaveLength(1);
		expect(updates[0]?.state).toBe('failed');
		expect(updates[0]?.telemetry.detail).toContain('Rejected local file');
	});

	it('runs remote clipboard save updates', async () => {
		const updates: RdpFileTransferUpdate[] = [];

		await saveRemoteClipboardToBrowser({
			save: async () => {},
			onUpdate: (update) => updates.push(update)
		});

		expect(updates.map((update) => update.state)).toEqual(['saving', 'complete']);
	});
});

function createFakeClipboardData(): RdpClipboardData & {
	binary: [string, Uint8Array][];
	freed: boolean;
	text: [string, string][];
} {
	return {
		binary: [],
		freed: false,
		text: [],
		addBinary(mimeType, binary) {
			this.binary.push([mimeType, binary]);
		},
		addText(mimeType, text) {
			this.text.push([mimeType, text]);
		},
		free() {
			this.freed = true;
		}
	};
}
