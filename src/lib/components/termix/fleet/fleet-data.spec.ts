import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
	buildBulkOperationReview,
	demoFleetOverview,
	fleetRiskLabel,
	fleetStatusLabel,
	filterFleetHosts,
	uniqueFleetValues
} from './fleet-data';

const performanceIt = process.env.TERMIXKIT_PERFORMANCE_BUDGETS === '1' ? it : it.skip;

describe('fleet operations helpers', () => {
	it('filters hosts by health, workspace, patch state, region, and search text', () => {
		const result = filterFleetHosts(demoFleetOverview.hosts, {
			search: 'postgres',
			status: 'degraded',
			workspace: 'Platform',
			region: 'ams',
			patchState: 'due'
		});

		expect(result.map((host) => host.id)).toEqual(['host-ams-db-01']);
	});

	it('keeps unique filter options sorted for stable controls', () => {
		expect(uniqueFleetValues(['sfo', 'ams', 'ams', 'fra'])).toEqual(['ams', 'fra', 'sfo']);
	});

	it('blocks bulk operations with offline targets before execution', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-restart-service'
		);
		const targets = demoFleetOverview.hosts.filter((host) =>
			['host-ams-api-01', 'host-sfo-edge-03'].includes(host.id)
		);

		const review = buildBulkOperationReview(operation, targets);

		expect(review).toMatchObject({
			targetCount: 2,
			offlineTargets: 1,
			approvalRequired: true,
			canRun: false
		});
		expect(review.blockers).toContain('Remove offline targets before running.');
	});

	it('labels fleet status and risk values without leaking enum casing into rendering helpers', () => {
		expect(
			(['healthy', 'degraded', 'offline', 'maintenance'] as const).map(fleetStatusLabel)
		).toEqual(['Healthy', 'Degraded', 'Offline', 'Maintenance']);
		expect((['low', 'medium', 'high'] as const).map(fleetRiskLabel)).toEqual([
			'Low',
			'Medium',
			'High'
		]);
	});

	performanceIt('keeps repeated fleet filtering inside a coarse rendering-helper budget', () => {
		const hosts = Array.from({ length: 600 }, (_, index) => ({
			...demoFleetOverview.hosts[index % demoFleetOverview.hosts.length],
			id: `host-${index}`,
			name: `host-${index}`,
			tags: [`tag-${index % 10}`, 'linux']
		}));

		const startedAt = performance.now();
		const result = filterFleetHosts(hosts, {
			search: 'linux',
			status: 'healthy',
			workspace: 'all',
			region: 'all',
			patchState: 'current'
		});
		const elapsedMs = performance.now() - startedAt;

		expect(result.every((host) => host.status === 'healthy' && host.patchState === 'current')).toBe(
			true
		);
		expect(result.length).toBeGreaterThan(0);
		expect(elapsedMs).toBeLessThan(250);
	});
});
