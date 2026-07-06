import {
	applyRdpDisplayPreset,
	normalizeDesktopDimension,
	type RdpDesktopSize
} from './rdp-operator-controls';
import type { RdpPerformancePreset } from '$lib/remotes/settings.remote';

export const minDesktopWidth = 320;
export const minDesktopHeight = 240;

export function preferredDesktopSize({
	viewportRect,
	fallback,
	preset
}: {
	viewportRect?: Pick<DOMRect, 'width' | 'height'> | null;
	fallback: RdpDesktopSize;
	preset: RdpPerformancePreset;
}) {
	const rawSize = {
		width: normalizeDesktopDimension(
			viewportRect?.width ?? fallback.width,
			minDesktopWidth,
			Number.MAX_SAFE_INTEGER,
			true
		),
		height: normalizeDesktopDimension(
			viewportRect?.height ?? fallback.height,
			minDesktopHeight,
			Number.MAX_SAFE_INTEGER,
			false
		)
	};
	const presetSize = applyRdpDisplayPreset(rawSize, preset);
	return {
		width: normalizeDesktopDimension(
			presetSize.width,
			minDesktopWidth,
			Number.MAX_SAFE_INTEGER,
			true
		),
		height: normalizeDesktopDimension(
			presetSize.height,
			minDesktopHeight,
			Number.MAX_SAFE_INTEGER,
			false
		)
	};
}

export function desktopSizeChanged(
	previous: RdpDesktopSize | null,
	next: RdpDesktopSize,
	force = false
) {
	return force || previous?.width !== next.width || previous.height !== next.height;
}

export function scaleFocusDetail(scale: 'fit' | 'fill' | 'real') {
	if (scale === 'fit') return 'Display scale set to fit.';
	if (scale === 'fill') return 'Display scale set to fill.';
	return 'Display scale set to 100%.';
}
