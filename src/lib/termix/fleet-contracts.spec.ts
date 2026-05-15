import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtInAutomationTemplates } from '$lib/termix/automation-template';
import {
	fleetBulkOperationContracts,
	fleetBulkOperations,
	resolveFleetBulkOperationContract
} from '$lib/termix/fleet-contracts';
import { demoFleetOverview } from '$lib/components/termix/fleet/fleet-data';
import {
	automationTemplateKinds,
	backgroundJobKinds,
	workspacePolicyCapabilities
} from '$lib/server/services/v6-resources';

const dashboardSource = readFixture('../components/termix/fleet/FleetDashboard.svelte');
const runbooksSource = readFixture('../components/termix/fleet/FleetRunbooksPage.svelte');
const runbooksPanelSource = readFixture(
	'../components/termix/fleet/AutomationTemplatesPanel.svelte'
);
const executionBuilderSource = readFixture(
	'../components/termix/fleet/FleetExecutionBuilder.svelte'
);
const bulkOperationsPanelSource = readFixture(
	'../components/termix/fleet/BulkOperationsPanel.svelte'
);
const approvalsSource = readFixture('../components/termix/fleet/FleetApprovalsPage.svelte');
const routeSource = readFixture('../../routes/(app)/fleet/+page.svelte');
const runbooksRouteSource = readFixture('../../routes/(app)/fleet/runbooks/+page.svelte');

describe('V6 fleet UI and remote contract wiring', () => {
	it('keeps visible bulk operation controls backed by V6 job and policy capabilities', () => {
		expect(fleetBulkOperations.map((operation) => operation.id)).toEqual(
			fleetBulkOperationContracts.map((operation) => operation.id)
		);

		for (const operation of fleetBulkOperationContracts) {
			expect(backgroundJobKinds).toContain(operation.jobKind);
			expect(workspacePolicyCapabilities).toContain(operation.policyCapability);
			expect(operation.secretPolicy).toBe('redacted');
			expect(resolveFleetBulkOperationContract(operation.id)).toMatchObject({
				id: operation.id,
				jobKind: operation.jobKind,
				jobTitle: operation.jobTitle
			});
		}
		expect(resolveFleetBulkOperationContract('unsupported-operation')).toBeNull();
	});

	it('keeps demo and helper data on the same V6 operation ids as the remote overview', () => {
		expect(demoFleetOverview.bulkOperations).toEqual(fleetBulkOperations);
		expect(demoFleetOverview.bulkOperations.map((operation) => operation.id)).toEqual([
			'bulk-ssh-command',
			'bulk-file-transfer'
		]);
	});

	it('keeps built-in automation template controls inside service-supported template kinds', () => {
		const builtInKinds = [...new Set(builtInAutomationTemplates.map((template) => template.kind))];

		expect(builtInKinds).toEqual([
			'ssh_command',
			'file_transfer',
			'ssh_tunnel',
			'rdp_checklist',
			'operator_note'
		]);
		for (const kind of builtInKinds) {
			expect(automationTemplateKinds).toContain(kind);
		}
	});

	it('renders the fleet route from the remote overview contract', () => {
		expect(routeSource).toContain("import { getFleetOverview } from '$lib/fleet.remote'");
		expect(routeSource).toContain(
			'<FleetDashboard overview={await getFleetOverview()} dataSourceLabel="remote functions" />'
		);
	});

	it('keeps routed mutation controls wired to remote commands and query refreshes', () => {
		expect(runbooksRouteSource).toContain('<FleetRunbooksPage />');

		expect(runbooksSource).toContain('AutomationTemplatesPanel');
		expect(runbooksSource).toContain('const runbooksQuery = getFleetRunbooks()');
		expect(runbooksSource).toContain('runbooksQuery.current?.templates');
		expect(runbooksSource).toContain('runbooksQuery.current?.workspaces');
		expect(runbooksSource).toContain('onCreateTemplate={createRunbook}');
		expect(runbooksSource).toMatch(
			/createFleetAutomationTemplate[\s\S]+\.updates\(getFleetRunbooks\)/
		);
		expect(runbooksSource).toContain('selectedRunbookId = created.id');
		expect(runbooksPanelSource).toContain('workspaceSelectionMissing');
		expect(runbooksPanelSource).toContain('Choose a workspace before saving this runbook.');
		expect(runbooksPanelSource).toContain('workspaces.length === 1');
		expect(runbooksPanelSource).toContain('$effect(() => {');
		expect(runbooksPanelSource).toContain('autoSelectedWorkspaceId');
		expect(runbooksPanelSource).toContain('onValueChange={changeWorkspace}');
		expect(runbooksPanelSource).toContain('onValueChange={changeVisibility}');

		expect(executionBuilderSource).toContain('BulkOperationsPanel');
		expect(executionBuilderSource).toContain('preflightFleetExecution');
		expect(executionBuilderSource).toContain('queueFleetBulkOperation');
		expect(executionBuilderSource).toContain('.updates(getFleetOverview)');

		expect(approvalsSource).toContain('PolicyApprovalsPanel');
		expect(approvalsSource).toMatch(/decideFleetApproval[\s\S]+\.updates\(getFleetApprovals\)/);
	});

	it('keeps bulk execution preflight authoritative over local review state', () => {
		expect(bulkOperationsPanelSource).toContain(
			'const executionReview = $derived(preflight ?? review)'
		);
		expect(bulkOperationsPanelSource).toMatch(
			/const canReviewExecution = \$derived\(\s*Boolean\(selectedOperation && selectedRunbook && targets\.length > 0\)\s*\)/
		);
		expect(bulkOperationsPanelSource).toContain('{executionReview.targetCount}');
		expect(bulkOperationsPanelSource).toContain('{executionReview.highRiskTargets}');
		expect(bulkOperationsPanelSource).toContain('{executionReview.offlineTargets}');
		expect(bulkOperationsPanelSource).toContain('{#if executionReview.approvalRequired}');
		expect(bulkOperationsPanelSource).toContain('{#each executionReview.blockers as blocker');
		expect(bulkOperationsPanelSource).toContain('{#each executionReview.warnings as warning');
		expect(bulkOperationsPanelSource).toContain('disabled={!canReviewExecution || reviewing}');
		expect(bulkOperationsPanelSource).toContain(
			'disabled={!canReviewExecution || !executionReview.canRun || reviewing || busy}'
		);
		expect(bulkOperationsPanelSource).toContain('if (reviewing) return;');
		expect(bulkOperationsPanelSource).toContain(
			"{busy ? 'Submitting...' : executionReview.ctaLabel}"
		);
		expect(executionBuilderSource).toContain('onPayloadChange={clearPreflight}');
		expect(executionBuilderSource).toContain('let preflightRequestToken = 0;');
		expect(executionBuilderSource).toContain('preflightRequestToken += 1;');
		expect(executionBuilderSource).toContain('const requestToken = preflightRequestToken + 1;');
		expect(executionBuilderSource).toMatch(
			/const result = await preflightFleetExecution\(input\);[\s\S]+if \(requestToken === preflightRequestToken\) \{[\s\S]+preflight = result;/
		);

		expect(bulkOperationsPanelSource).not.toMatch(/\{#if review\.approvalRequired\}/);
		expect(bulkOperationsPanelSource).not.toContain('{review.targetCount}');
		expect(bulkOperationsPanelSource).not.toContain('{review.highRiskTargets}');
		expect(bulkOperationsPanelSource).not.toContain('{review.offlineTargets}');
		expect(bulkOperationsPanelSource).not.toMatch(/\{#each review\.blockers/);
		expect(bulkOperationsPanelSource).not.toMatch(/\{#each review\.warnings/);
		expect(bulkOperationsPanelSource).not.toContain(
			'disabled={!executionReview.canRun || reviewing}'
		);
		expect(bulkOperationsPanelSource).not.toMatch(/disabled=\{!review\.canRun/);
		expect(bulkOperationsPanelSource).not.toContain('preflight?.ctaLabel ?? review.ctaLabel');
	});

	it('clears stale preflight when local execution payload inputs change', () => {
		expect(bulkOperationsPanelSource).toContain('onPayloadChange?: () => void');
		expect(bulkOperationsPanelSource).toContain('onPayloadChange?.()');
		expect(bulkOperationsPanelSource).toMatch(
			/<Input[\s\S]+id="fleet-bulk-reason"[\s\S]+oninput=\{payloadChanged\}/
		);
		expect(bulkOperationsPanelSource).toMatch(
			/<Input[\s\S]+id="fleet-bulk-concurrency"[\s\S]+oninput=\{payloadChanged\}/
		);
	});

	it('keeps fleet overview routed to concrete operator sections', () => {
		expect(dashboardSource).toContain('/fleet/executions/new');
		expect(dashboardSource).toContain('/fleet/targets');
	});
});

function readFixture(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
