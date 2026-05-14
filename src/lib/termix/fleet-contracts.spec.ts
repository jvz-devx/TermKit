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

	it('keeps dashboard mutation controls wired to remote commands and overview refreshes', () => {
		const controls = [
			{
				component: 'AutomationTemplatesPanel',
				prop: 'onCreateTemplate={createTemplate}',
				handler: 'createTemplate',
				remote: 'createFleetAutomationTemplate'
			},
			{
				component: 'BulkOperationsPanel',
				prop: 'onQueueOperation={queueOperation}',
				handler: 'queueOperation',
				remote: 'queueFleetBulkOperation'
			},
			{
				component: 'PolicyApprovalsPanel',
				prop: 'onDecideApproval={decideApproval}',
				handler: 'decideApproval',
				remote: 'decideFleetApproval'
			}
		];

		for (const control of controls) {
			expect(dashboardSource).toContain(control.component);
			expect(dashboardSource).toContain(control.prop);
			expect(dashboardSource).toMatch(
				new RegExp(
					`async function ${control.handler}[\\s\\S]+${control.remote}[\\s\\S]+\\.updates\\(getFleetOverview\\)`
				)
			);
		}
	});
});

function readFixture(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
