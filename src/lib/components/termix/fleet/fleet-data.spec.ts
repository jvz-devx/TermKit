import { describe, expect, it } from 'vitest';
import {
	buildBulkOperationReview,
	demoFleetOverview,
	filterFleetHosts,
	uniqueFleetValues
} from './fleet-data';

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
});
