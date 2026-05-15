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
			(candidate) => candidate.id === 'bulk-file-transfer'
		);
		const runbook = demoFleetOverview.templates[0];
		const targets = demoFleetOverview.hosts.filter((host) =>
			['host-ams-api-01', 'host-sfo-edge-03'].includes(host.id)
		);

		const review = buildBulkOperationReview(operation, runbook, targets);

		expect(review).toMatchObject({
			targetCount: 2,
			offlineTargets: 1,
			approvalRequired: true,
			canRun: false
		});
		expect(review.blockers).toContain('Remove offline targets before running.');
	});

	it('blocks approval-required mixed workspace and personal target reviews', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-file-transfer'
		);
		const runbook = demoFleetOverview.templates[0];
		const workspaceHost = demoFleetOverview.hosts[0];
		const personalHost = {
			...demoFleetOverview.hosts[5],
			id: 'host-personal',
			workspaceId: null,
			workspace: 'Personal'
		};

		const review = buildBulkOperationReview(operation, runbook, [workspaceHost, personalHost]);

		expect(review).toMatchObject({
			approvalRequired: true,
			canRun: false
		});
		expect(review.blockers).toContain(
			'approval-required executions require every target to belong to a workspace'
		);
	});

	it('blocks approval-required target reviews spanning multiple workspaces', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-file-transfer'
		);
		const runbook = demoFleetOverview.templates[0];
		const platformHost = demoFleetOverview.hosts[0];
		const supportHost = demoFleetOverview.hosts[2];

		const review = buildBulkOperationReview(operation, runbook, [platformHost, supportHost]);

		expect(review).toMatchObject({
			approvalRequired: true,
			canRun: false
		});
		expect(review.blockers).toContain(
			'approval-required executions must target one workspace at a time until approval requests can be created atomically.'
		);
	});

	it('blocks non-approval mixed workspace and personal target reviews', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-ssh-command'
		);
		const runbook = demoFleetOverview.templates.find(
			(candidate) => candidate.id === 'template-inventory-sync'
		);
		const workspaceHost = demoFleetOverview.hosts[3];
		const personalHost = {
			...demoFleetOverview.hosts[5],
			id: 'host-personal',
			workspaceId: null,
			workspace: 'Personal',
			riskScore: 12
		};

		const review = buildBulkOperationReview(operation, runbook, [workspaceHost, personalHost]);

		expect(review).toMatchObject({
			approvalRequired: false,
			canRun: false
		});
		expect(review.blockers).toContain(
			'Select targets from one workspace or personal scope; mixed-scope executions are blocked until job history supports multiple scopes.'
		);
	});

	it('keeps high-risk non-approval operations runnable with a warning', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-ssh-command'
		);
		const runbook = demoFleetOverview.templates.find(
			(candidate) => candidate.id === 'template-inventory-sync'
		);
		const highRiskTarget = {
			...demoFleetOverview.hosts[0],
			id: 'host-high-risk',
			riskScore: 12,
			tags: ['critical']
		};

		const review = buildBulkOperationReview(operation, runbook, [highRiskTarget]);

		expect(review).toMatchObject({
			highRiskTargets: 1,
			approvalRequired: false,
			canRun: true
		});
		expect(review.blockers).toEqual([]);
		expect(review.warnings).toContain('1 selected target(s) are high risk.');
	});

	it('uses critical tags rather than riskScore for high-risk warning parity', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-ssh-command'
		);
		const runbook = demoFleetOverview.templates.find(
			(candidate) => candidate.id === 'template-inventory-sync'
		);
		const scoredTarget = {
			...demoFleetOverview.hosts[0],
			id: 'host-score-only',
			riskScore: 95,
			tags: ['production']
		};

		const review = buildBulkOperationReview(operation, runbook, [scoredTarget]);

		expect(review).toMatchObject({
			highRiskTargets: 0,
			canRun: true
		});
		expect(review.warnings).not.toContain('1 selected target(s) are high risk.');
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
