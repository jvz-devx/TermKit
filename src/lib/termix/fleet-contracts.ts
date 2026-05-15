export type FleetBulkOperationContract = {
	id: 'bulk-ssh-command' | 'bulk-file-transfer';
	name: string;
	category: string;
	description: string;
	risk: 'low' | 'medium' | 'high';
	estimatedDuration: string;
	guardrails: string[];
	jobKind: 'bulk_ssh_command' | 'bulk_file_transfer';
	jobTitle: string;
	secretPolicy: 'redacted';
};

export type VisibleFleetBulkOperation = Omit<
	FleetBulkOperationContract,
	'jobKind' | 'jobTitle' | 'secretPolicy'
>;

export const fleetBulkOperationContracts = [
	{
		id: 'bulk-ssh-command',
		name: 'Bulk SSH command',
		category: 'SSH',
		description: 'Run an SSH command job against the selected hosts.',
		risk: 'medium',
		estimatedDuration: 'queued',
		guardrails: [
			'Shows exact target count before running',
			'Limits fan-out concurrency',
			'Stores bounded, redacted per-host status'
		],
		jobKind: 'bulk_ssh_command',
		jobTitle: 'Bulk SSH command',
		secretPolicy: 'redacted'
	},
	{
		id: 'bulk-file-transfer',
		name: 'Bulk file transfer',
		category: 'Files',
		description: 'Queue an SFTP/FTP/FTPS transfer job against the selected hosts.',
		risk: 'high',
		estimatedDuration: 'queued',
		guardrails: [
			'Requires visible target selection',
			'Reports partial failures',
			'Does not store transferred file contents'
		],
		jobKind: 'bulk_file_transfer',
		jobTitle: 'Bulk file transfer',
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
		estimatedDuration: operation.estimatedDuration,
		guardrails: operation.guardrails
	};
}
