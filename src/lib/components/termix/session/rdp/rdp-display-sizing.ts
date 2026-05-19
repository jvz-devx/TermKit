import {
	applyRdpDisplayPreset,
	normalizeDesktopDimension,
	type RdpDesktopSize
} from './rdp-operator-controls';
import type { RdpPerformancePreset } from '$lib/remotes/settings.remote';

export const minDesktopWidth = 640;
export const minDesktopHeight = 480;
export const maxDesktopWidth = 7680;
export const maxDesktopHeight = 4320;

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
			maxDesktopWidth,
			true
		),
		height: normalizeDesktopDimension(
			viewportRect?.height ?? fallback.height,
			minDesktopHeight,
			maxDesktopHeight,
			false
		)
	};
	return applyRdpDisplayPreset(rawSize, preset);
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
