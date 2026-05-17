import { describe, expect, it } from 'vitest';
import { installRdpSessionCapture, setRdpClipboardCapture } from './rdp-session-capture';

describe('RDP session capture helpers', () => {
	it('captures sessions created through the backend session builder once', async () => {
		const session = { onClipboardPaste: async () => undefined };
		const target = {};
		const prototype = {
			connect: async () => session
		};
		const backend = {
			Backend: {
				SessionBuilder: { prototype }
			}
		};
		const captured: unknown[] = [];

		setRdpClipboardCapture((nextSession) => captured.push(nextSession), target as never);
		expect(installRdpSessionCapture(backend, target as never)).toBe(true);
		expect(installRdpSessionCapture(backend, target as never)).toBe(false);

		await prototype.connect();
		expect(captured).toEqual([session]);
	});

	it('leaves incomplete backends untouched', () => {
		expect(installRdpSessionCapture({ Backend: { SessionBuilder: {} } }, {} as never)).toBe(false);
	});
});
