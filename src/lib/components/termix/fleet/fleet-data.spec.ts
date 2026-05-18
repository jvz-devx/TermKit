import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
	buildBulkOperationSummary,
	demoFleetOverview,
	fleetRiskLabel,
	fleetStatusLabel,
	filterFleetHosts,
	resolveFleetOperationForRunbook,
	uniqueFleetValues
} from './fleet-data';

const performanceIt = process.env.TERMKIT_PERFORMANCE_BUDGETS === '1' ? it : it.skip;

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

	it('keeps health and risk as context without blocking execution', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-file-transfer'
		);
		const runbook = demoFleetOverview.templates[0];
		const targets = demoFleetOverview.hosts.filter((host) =>
			['host-ams-api-01', 'host-sfo-edge-03'].includes(host.id)
		);

		const summary = buildBulkOperationSummary(operation, runbook, targets);

		expect(summary).toMatchObject({
			targetCount: 2,
			canRun: true,
			ctaLabel: 'Run operation',
			warning: 'This will run on 2 hosts.'
		});
		expect(summary.missingInputs).toEqual([]);
	});

	it('only blocks technically missing execution inputs', () => {
		const operation = demoFleetOverview.bulkOperations.find(
			(candidate) => candidate.id === 'bulk-ssh-command'
		);
		const summary = buildBulkOperationSummary(operation, null, []);

		expect(summary).toMatchObject({
			targetCount: 0,
			canRun: false,
			warning: 'This will run on 0 hosts.'
		});
		expect(summary.missingInputs).toEqual(['Choose an action.', 'Select at least one target.']);
	});

	it('maps runnable runbooks to the matching backend operation', () => {
		const sshRunbook = { ...demoFleetOverview.templates[0], category: 'ssh command' };
		const fileRunbook = { ...demoFleetOverview.templates[0], category: 'file transfer' };
		const noteRunbook = { ...demoFleetOverview.templates[0], category: 'operator note' };

		expect(resolveFleetOperationForRunbook(sshRunbook, demoFleetOverview.bulkOperations)?.id).toBe(
			'bulk-ssh-command'
		);
		expect(resolveFleetOperationForRunbook(fileRunbook, demoFleetOverview.bulkOperations)?.id).toBe(
			'bulk-file-transfer'
		);
		expect(
			resolveFleetOperationForRunbook(noteRunbook, demoFleetOverview.bulkOperations)
		).toBeNull();
	});

	it('allows mixed workspace, personal, and high-risk targets once inputs exist', () => {
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
		const personalTarget = {
			...demoFleetOverview.hosts[5],
			id: 'host-personal',
			workspaceId: null,
			workspace: 'Personal'
		};

		const summary = buildBulkOperationSummary(operation, runbook, [highRiskTarget, personalTarget]);

		expect(summary).toMatchObject({
			targetCount: 2,
			canRun: true,
			warning: 'This will run on 2 hosts.'
		});
		expect(summary.missingInputs).toEqual([]);
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
