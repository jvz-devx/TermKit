import { terminalFontSize } from '$lib/termix/host-metadata';
import type { HostSummary } from '$lib/termix.remote';
import { layoutGridDimensions } from './session-workspace-layout-dimensions';
import type { SessionLayoutKind } from './workspace-layout';

export function estimateWorkspaceTerminalSize({
	bounds,
	innerWidth,
	layout,
	host,
	defaultFontSize
}: {
	bounds?: Pick<DOMRect, 'width' | 'height'> | null;
	innerWidth: number;
	layout: SessionLayoutKind;
	host: HostSummary;
	defaultFontSize: number;
}) {
	if (!bounds?.width || !bounds?.height) return { cols: 80, rows: 24 };

	const large = innerWidth >= 1024;
	const { columns, rows } = layoutGridDimensions(layout, large);
	const fontSize = terminalFontSize(host.terminalPreferences, defaultFontSize);
	const paneWidth = (bounds.width - 16 - Math.max(0, columns - 1) * 8) / columns;
	const paneHeight = (bounds.height - 148 - Math.max(0, rows - 1) * 8) / rows;
	const charWidth = Math.max(6, fontSize * 0.62);
	const rowHeight = Math.max(12, fontSize * 1.35);

	return {
		cols: Math.floor(Math.max(40, Math.min(240, (paneWidth - 24) / charWidth))),
		rows: Math.floor(Math.max(12, Math.min(80, (paneHeight - 96) / rowHeight)))
	};
}
