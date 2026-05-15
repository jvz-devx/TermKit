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
const executionBuilderSource = readFixture('../components/termix/fleet/FleetExecutionBuilder.svelte');
const approvalsSource = readFixture('../components/termix/fleet/FleetApprovalsPage.svelte');
const routeSource = readFixture('../../routes/(app)/fleet/+page.svelte');

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
		expect(runbooksSource).toContain('AutomationTemplatesPanel');
		expect(runbooksSource).toContain('onCreateTemplate={createRunbook}');
		expect(runbooksSource).toMatch(
			/createFleetAutomationTemplate[\s\S]+\.updates\(getFleetRunbooks\)/
		);

		expect(executionBuilderSource).toContain('BulkOperationsPanel');
		expect(executionBuilderSource).toContain('preflightFleetExecution');
		expect(executionBuilderSource).toContain('queueFleetBulkOperation');
		expect(executionBuilderSource).toContain('.updates(getFleetOverview)');

		expect(approvalsSource).toContain('PolicyApprovalsPanel');
		expect(approvalsSource).toMatch(/decideFleetApproval[\s\S]+\.updates\(getFleetApprovals\)/);
	});

	it('keeps fleet overview routed to concrete operator sections', () => {
		expect(dashboardSource).toContain('/fleet/executions/new');
		expect(dashboardSource).toContain('/fleet/targets');
	});
});

function readFixture(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
