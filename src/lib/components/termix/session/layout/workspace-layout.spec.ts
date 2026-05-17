import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
	createDefaultSessionLayout,
	normalizeSessionLayout,
	removeSessionPane,
	resizeSessionLayout,
	updateSessionPaneKind,
	updateSessionPaneHost
} from './workspace-layout';

const performanceIt = process.env.TERMIXKIT_PERFORMANCE_BUDGETS === '1' ? it : it.skip;

describe('session workspace layout metadata', () => {
	it('preserves pane host ids and supports per-pane host replacement', () => {
		const layout = normalizeSessionLayout(
			{
				layout: 'two-columns',
				panes: [
					{ id: 'left', kind: 'ssh', hostId: 'host-1' },
					{ id: 'right', kind: 'ftp', hostId: 'host-2' }
				]
			},
			'single',
			'ssh',
			'fallback-host'
		);

		expect(layout.panes).toEqual([
			{ id: 'left', kind: 'ssh', hostId: 'host-1' },
			{ id: 'right', kind: 'ftp', hostId: 'host-2' }
		]);
		expect(updateSessionPaneHost(layout, 'right', 'host-3').panes[1]).toMatchObject({
			hostId: 'host-3'
		});
	});

	it('compacts the layout when a pane is closed', () => {
		const layout = normalizeSessionLayout(
			{
				layout: 'two-columns',
				panes: [
					{ id: 'left', kind: 'ssh', hostId: 'host-1' },
					{ id: 'right', kind: 'sftp', hostId: 'host-1' }
				]
			},
			'single',
			'ssh',
			'host-1'
		);

		expect(removeSessionPane(layout, 'right', 'ssh', 'host-1')).toMatchObject({
			layout: 'single',
			panes: [{ id: 'left', kind: 'ssh', hostId: 'host-1' }]
		});
	});

	it('preserves all remaining panes when closing from a quad layout to three panes', () => {
		const layout = normalizeSessionLayout(
			{
				layout: 'quad',
				panes: [
					{ id: 'one', kind: 'ssh', hostId: 'host-1' },
					{ id: 'two', kind: 'sftp', hostId: 'host-1' },
					{ id: 'three', kind: 'rdp', hostId: 'host-2' },
					{ id: 'four', kind: 'vnc', hostId: 'host-3' }
				]
			},
			'single',
			'ssh',
			'fallback-host'
		);

		expect(removeSessionPane(layout, 'two', 'ssh', 'host-1')).toMatchObject({
			layout: 'three',
			panes: [
				{ id: 'one', kind: 'ssh', hostId: 'host-1' },
				{ id: 'three', kind: 'rdp', hostId: 'host-2' },
				{ id: 'four', kind: 'vnc', hostId: 'host-3' }
			]
		});
	});

	it('builds deterministic multi-pane defaults for dense protocol workspaces', () => {
		expect(createDefaultSessionLayout('quad', 'rdp', 'host-1').panes).toEqual([
			{ id: 'pane-1', kind: 'rdp', hostId: 'host-1' },
			{ id: 'pane-2', kind: 'ssh', hostId: 'host-1' },
			{ id: 'pane-3', kind: 'sftp', hostId: 'host-1' },
			{ id: 'pane-4', kind: 'vnc', hostId: 'host-1' }
		]);
		expect(createDefaultSessionLayout('two-columns', 'telnet', null).panes).toEqual([
			{ id: 'pane-1', kind: 'telnet', hostId: null },
			{ id: 'pane-2', kind: 'ssh', hostId: null }
		]);
	});

	it('resizes and mutates workspace layout metadata while preserving existing panes', () => {
		const layout = normalizeSessionLayout(
			{
				layout: 'quad',
				panes: [
					{ id: 'one', kind: 'ssh', hostId: 'host-1' },
					{ id: 'two', kind: 'sftp', hostId: 'host-1' },
					{ id: 'three', kind: 'rdp', hostId: 'host-2' },
					{ id: 'four', kind: 'vnc', hostId: 'host-3' }
				]
			},
			'single',
			'ssh',
			'fallback-host'
		);

		const compact = resizeSessionLayout(layout, 'two-rows', 'ssh', 'fallback-host');
		const changed = updateSessionPaneKind(compact, 'two', 'ftp');

		expect(compact).toMatchObject({
			layout: 'two-rows',
			panes: [
				{ id: 'one', kind: 'ssh', hostId: 'host-1' },
				{ id: 'two', kind: 'sftp', hostId: 'host-1' }
			]
		});
		expect(changed.panes[1]).toMatchObject({ id: 'two', kind: 'ftp' });
		expect(changed.updatedAt).toEqual(expect.any(String));
	});

	it('keeps dense workspace normalization bounded to renderable panes', () => {
		const propertyReads = new Map<string, number>();
		const panes = Array.from({ length: 500 }, (_, index) => countedPane(index, propertyReads));

		const layout = normalizeSessionLayout(
			{
				layout: 'quad',
				panes
			},
			'single',
			'ssh',
			'fallback-host'
		);

		expect(layout.panes).toEqual([
			{ id: 'pane-0', kind: 'ssh', hostId: 'host-0' },
			{ id: 'pane-1', kind: 'sftp', hostId: 'host-1' },
			{ id: 'pane-2', kind: 'rdp', hostId: 'host-2' },
			{ id: 'pane-3', kind: 'vnc', hostId: 'host-3' }
		]);
		expect(propertyReads.size).toBe(4);
		expect(
			[...propertyReads.values()].reduce((total, count) => total + count, 0)
		).toBeLessThanOrEqual(32);
	});

	performanceIt(
		'keeps representative workspace layout creation and normalization within budget',
		() => {
			const budgetMs = 250;
			const iterations = 5_000;
			const oversizedPanes = Array.from({ length: 1_000 }, (_, index) => ({
				id: `pane-${index}`,
				kind: ['ssh', 'sftp', 'rdp', 'vnc'][index % 4],
				hostId: `host-${index}`
			}));
			let normalizedPaneCount = 0;
			let createdPaneCount = 0;

			const startedAt = performance.now();
			for (let index = 0; index < iterations; index += 1) {
				const normalized = normalizeSessionLayout(
					{
						layout: 'quad',
						panes: oversizedPanes,
						updatedAt: '2026-05-15T10:00:00.000Z'
					},
					'single',
					'ssh',
					'fallback-host'
				);
				const created = createDefaultSessionLayout(
					index % 2 === 0 ? 'quad' : 'two-columns',
					index % 3 === 0 ? 'rdp' : 'ssh',
					`host-${index % 10}`
				);

				normalizedPaneCount += normalized.panes.length;
				createdPaneCount += created.panes.length;
			}
			const elapsedMs = performance.now() - startedAt;

			expect(normalizedPaneCount).toBe(iterations * 4);
			expect(createdPaneCount).toBe(iterations * 3);
			expect(elapsedMs).toBeLessThan(budgetMs);
		}
	);
});

function countedPane(index: number, propertyReads: Map<string, number>) {
	const increment = () => {
		const key = `pane-${index}`;
		propertyReads.set(key, (propertyReads.get(key) ?? 0) + 1);
	};

	return {
		get id() {
			increment();
			return `pane-${index}`;
		},
		get kind() {
			increment();
			return ['ssh', 'sftp', 'rdp', 'vnc'][index % 4];
		},
		get hostId() {
			increment();
			return `host-${index}`;
		}
	};
}
