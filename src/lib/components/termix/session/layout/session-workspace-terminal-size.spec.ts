import { describe, expect, it } from 'vitest';
import { estimateWorkspaceTerminalSize } from './session-workspace-terminal-size';

describe('session workspace terminal sizing', () => {
	it('uses fallback size when bounds are missing', () => {
		expect(
			estimateWorkspaceTerminalSize({
				bounds: null,
				innerWidth: 1440,
				layout: 'single',
				host: { terminalPreferences: {} } as never,
				defaultFontSize: 13
			})
		).toEqual({ cols: 80, rows: 24 });
	});

	it('estimates columns and rows from workspace dimensions', () => {
		const size = estimateWorkspaceTerminalSize({
			bounds: { width: 1200, height: 800 },
			innerWidth: 1440,
			layout: 'two-columns',
			host: { terminalPreferences: { fontSize: 14 } } as never,
			defaultFontSize: 13
		});

		expect(size.cols).toBeGreaterThanOrEqual(40);
		expect(size.rows).toBeGreaterThanOrEqual(12);
	});
});
