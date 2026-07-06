import { describe, expect, it } from 'vitest';
import { desktopSizeChanged, preferredDesktopSize, scaleFocusDetail } from './rdp-display-sizing';

describe('RDP display sizing helpers', () => {
	it('resolves preferred desktop sizes from viewport bounds', () => {
		expect(
			preferredDesktopSize({
				viewportRect: { width: 1280, height: 720 },
				fallback: { width: 1440, height: 900 },
				preset: 'balanced'
			})
		).toEqual({ width: 1280, height: 720 });
	});

	it('uses the available ultrawide viewport size without preset caps', () => {
		expect(
			preferredDesktopSize({
				viewportRect: { width: 3440, height: 1440 },
				fallback: { width: 1440, height: 900 },
				preset: 'balanced'
			})
		).toEqual({ width: 3440, height: 1440 });
	});

	it('allows narrow session sidebars without forcing horizontal clipping', () => {
		expect(
			preferredDesktopSize({
				viewportRect: { width: 480, height: 603 },
				fallback: { width: 1440, height: 900 },
				preset: 'balanced'
			})
		).toEqual({ width: 480, height: 603 });
	});

	it('clamps collapsed viewport bounds to a usable RDP desktop size', () => {
		expect(
			preferredDesktopSize({
				viewportRect: { width: 532, height: 42 },
				fallback: { width: 1440, height: 900 },
				preset: 'balanced'
			})
		).toEqual({ width: 532, height: 240 });
	});

	it('detects changed desktop size unless forced', () => {
		expect(desktopSizeChanged({ width: 100, height: 100 }, { width: 100, height: 100 })).toBe(
			false
		);
		expect(desktopSizeChanged({ width: 100, height: 100 }, { width: 101, height: 100 })).toBe(true);
		expect(desktopSizeChanged({ width: 100, height: 100 }, { width: 100, height: 100 }, true)).toBe(
			true
		);
	});

	it('describes scale mode changes', () => {
		expect(scaleFocusDetail('fit')).toBe('Display scale set to fit.');
		expect(scaleFocusDetail('fill')).toBe('Display scale set to fill.');
		expect(scaleFocusDetail('real')).toBe('Display scale set to 100%.');
	});
});
