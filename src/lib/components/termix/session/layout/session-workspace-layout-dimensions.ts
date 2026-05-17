import type { SessionLayoutKind } from './workspace-layout';

export function layoutGridDimensions(layout: SessionLayoutKind, large: boolean) {
	if (layout === 'single') return { columns: 1, rows: 1 };
	if (layout === 'two-columns') return large ? { columns: 2, rows: 1 } : { columns: 1, rows: 2 };
	if (layout === 'two-rows') return { columns: 1, rows: 2 };
	if (layout === 'three') return large ? { columns: 2, rows: 2 } : { columns: 1, rows: 3 };
	return large ? { columns: 2, rows: 2 } : { columns: 1, rows: 4 };
}
