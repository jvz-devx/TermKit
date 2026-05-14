export type FleetBulkOperationContract = {
	id: 'bulk-ssh-command' | 'bulk-file-transfer';
	name: string;
	category: string;
	description: string;
	risk: 'low' | 'medium' | 'high';
	approvalRequired: boolean;
	estimatedDuration: string;
	guardrails: string[];
	jobKind: 'bulk_ssh_command' | 'bulk_file_transfer';
	jobTitle: string;
	policyCapability: 'bulk_job';
	secretPolicy: 'redacted';
};

export type VisibleFleetBulkOperation = Omit<
	FleetBulkOperationContract,
	'jobKind' | 'jobTitle' | 'policyCapability' | 'secretPolicy'
>;

export const fleetBulkOperationContracts = [
	{
		id: 'bulk-ssh-command',
		name: 'Bulk SSH command',
		category: 'SSH',
		description: 'Run a reviewed SSH command job against the selected visible hosts.',
		risk: 'medium',
		approvalRequired: false,
		estimatedDuration: 'queued',
		guardrails: [
			'Requires explicit target review',
			'Limits fan-out concurrency',
			'Stores bounded, redacted per-host status'
		],
		jobKind: 'bulk_ssh_command',
		jobTitle: 'Bulk SSH command',
		policyCapability: 'bulk_job',
		secretPolicy: 'redacted'
	},
	{
		id: 'bulk-file-transfer',
		name: 'Bulk file transfer',
		category: 'Files',
		description: 'Queue an SFTP/FTP/FTPS transfer job against the reviewed target set.',
		risk: 'high',
		approvalRequired: true,
		estimatedDuration: 'queued',
		guardrails: [
			'Requires visible target selection',
			'Reports partial failures',
			'Does not store transferred file contents'
		],
		jobKind: 'bulk_file_transfer',
		jobTitle: 'Bulk file transfer',
		policyCapability: 'bulk_job',
		secretPolicy: 'redacted'
	}
] as const satisfies readonly FleetBulkOperationContract[];

export const fleetBulkOperations = fleetBulkOperationContracts.map((operation) =>
	toVisibleFleetBulkOperation(operation)
) satisfies VisibleFleetBulkOperation[];

export function resolveFleetBulkOperationContract(
	operationId: string
): FleetBulkOperationContract | null {
	return fleetBulkOperationContracts.find((operation) => operation.id === operationId) ?? null;
}

function toVisibleFleetBulkOperation(
	operation: FleetBulkOperationContract
): VisibleFleetBulkOperation {
	return {
		id: operation.id,
		name: operation.name,
		category: operation.category,
		description: operation.description,
		risk: operation.risk,
		approvalRequired: operation.approvalRequired,
		estimatedDuration: operation.estimatedDuration,
		guardrails: operation.guardrails
	};
}
