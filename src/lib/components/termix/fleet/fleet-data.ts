import {
	fleetBulkOperations,
	formatFleetAttentionWarning,
	formatFleetHighRiskWarning,
	hasFleetCriticalTargetTag
} from '$lib/termix/fleet-contracts';

export type FleetHealthStatus = 'healthy' | 'degraded' | 'offline' | 'maintenance';
export type FleetTargetStatus = 'healthy' | 'needs_attention' | 'offline' | 'not_checked';
export type FleetRiskLevel = 'low' | 'medium' | 'high';
export type FleetJobStatus = 'queued' | 'running' | 'blocked' | 'completed' | 'failed';
export type FleetApprovalStatus = 'pending' | 'approved' | 'rejected';

export type FleetTargetHealthSummary = {
	status: FleetTargetStatus;
	label: string;
	reason: string;
	sourceState: string;
	lastCheckedAt: string | null;
	nextCheckAt: string | null;
	lastSuccessfulConnectionAt: string | null;
	lastFailedConnectionAt: string | null;
	consecutiveFailures: number;
	credentialSignal: 'ok' | 'failed' | 'unknown';
	reachabilitySignal: 'reachable' | 'unreachable' | 'unknown';
};

export type FleetHost = {
	id: string;
	name: string;
	hostname: string;
	workspaceId: string | null;
	workspace: string;
	owner: string;
	environment: 'production' | 'staging' | 'development';
	region: string;
	os: string;
	status: FleetHealthStatus;
	cpuLoad: number;
	memoryLoad: number;
	riskScore: number;
	lastSeenMinutes: number;
	patchState: 'current' | 'due' | 'overdue';
	protocols: string[];
	tags: string[];
	health?: FleetTargetHealthSummary;
};

export type FleetAutomationTemplate = {
	id: string;
	name: string;
	workspaceId: string | null;
	category: string;
	description: string;
	risk: FleetRiskLevel;
	approvalRequired: boolean;
	estimatedDuration: string;
	lastRun: string;
	parameters: string[];
};

export type FleetBulkOperation = {
	id: string;
	name: string;
	category: string;
	description: string;
	risk: FleetRiskLevel;
	approvalRequired: boolean;
	estimatedDuration: string;
	guardrails: string[];
};

export type FleetJob = {
	id: string;
	name: string;
	status: FleetJobStatus;
	startedAt: string;
	duration: string;
	targets: number;
	successful: number;
	failed: number;
	requestedBy: string;
	reportUrl: string;
};

export type FleetPolicy = {
	id: string;
	name: string;
	scope: string;
	status: FleetApprovalStatus;
	requestedBy: string;
	approver: string;
	dueAt: string;
	impact: string;
};

export type FleetWorkspace = {
	id: string;
	name: string;
};

export type FleetRunbook = FleetAutomationTemplate;
export type FleetTarget = FleetHost;
export type FleetExecution = FleetJob;
export type FleetApprovalRequest = FleetPolicy;

export type FleetOverview = {
	workspaces: FleetWorkspace[];
	hosts: FleetHost[];
	templates: FleetAutomationTemplate[];
	bulkOperations: FleetBulkOperation[];
	jobs: FleetJob[];
	policies: FleetPolicy[];
};

export type FleetRunbooksData = {
	workspaces: FleetWorkspace[];
	templates: FleetAutomationTemplate[];
};

export type FleetHostFilters = {
	search: string;
	status: FleetHealthStatus | 'all';
	workspace: string;
	region: string;
	patchState: FleetHost['patchState'] | 'all';
};

export type FleetTargetReview = {
	targetCount: number;
	highRiskTargets: number;
	offlineTargets: number;
	approvalRequired: boolean;
	canRun: boolean;
	ctaLabel: string;
	blockers: string[];
	warnings: string[];
};

export type FleetExecutionPreflight = FleetTargetReview & {
	runbookId: string | null;
	operationId: string | null;
	targetHostIds: string[];
};

export type FleetExecutionSubmitResult =
	| { status: 'queued'; job: FleetJob; message: string }
	| { status: 'approval_requested'; job?: null; message: string };

const approvalWorkspaceTargetMessage =
	'approval-required executions require every target to belong to a workspace';
const approvalWorkspaceScopeMessage =
	'approval-required executions must target one workspace at a time until approval requests can be created atomically.';
const mixedExecutionScopeMessage =
	'Select targets from one workspace or personal scope; mixed-scope executions are blocked until job history supports multiple scopes.';

export const demoFleetOverview: FleetOverview = {
	hosts: [
		{
			id: 'host-ams-api-01',
			name: 'ams-api-01',
			hostname: 'ams-api-01.internal',
			workspaceId: 'workspace-platform',
			workspace: 'Platform',
			owner: 'SRE',
			environment: 'production',
			region: 'ams',
			os: 'Ubuntu 24.04',
			status: 'healthy',
			cpuLoad: 42,
			memoryLoad: 58,
			riskScore: 31,
			lastSeenMinutes: 2,
			patchState: 'current',
			protocols: ['ssh', 'sftp'],
			tags: ['api', 'systemd']
		},
		{
			id: 'host-ams-db-01',
			name: 'ams-db-01',
			hostname: 'ams-db-01.internal',
			workspaceId: 'workspace-platform',
			workspace: 'Platform',
			owner: 'Database',
			environment: 'production',
			region: 'ams',
			os: 'Debian 12',
			status: 'degraded',
			cpuLoad: 77,
			memoryLoad: 84,
			riskScore: 72,
			lastSeenMinutes: 5,
			patchState: 'due',
			protocols: ['ssh'],
			tags: ['postgres', 'critical']
		},
		{
			id: 'host-fra-rdp-07',
			name: 'fra-rdp-07',
			hostname: 'fra-rdp-07.corp',
			workspaceId: 'workspace-support',
			workspace: 'Support',
			owner: 'Helpdesk',
			environment: 'production',
			region: 'fra',
			os: 'Windows Server 2022',
			status: 'healthy',
			cpuLoad: 28,
			memoryLoad: 46,
			riskScore: 44,
			lastSeenMinutes: 1,
			patchState: 'current',
			protocols: ['rdp'],
			tags: ['desktop', 'entra']
		},
		{
			id: 'host-nyc-build-02',
			name: 'nyc-build-02',
			hostname: 'nyc-build-02.internal',
			workspaceId: 'workspace-engineering',
			workspace: 'Engineering',
			owner: 'Developer Experience',
			environment: 'development',
			region: 'nyc',
			os: 'NixOS 26.05',
			status: 'maintenance',
			cpuLoad: 12,
			memoryLoad: 39,
			riskScore: 18,
			lastSeenMinutes: 24,
			patchState: 'current',
			protocols: ['ssh', 'vnc'],
			tags: ['builders', 'gpu']
		},
		{
			id: 'host-sfo-edge-03',
			name: 'sfo-edge-03',
			hostname: 'sfo-edge-03.edge',
			workspaceId: 'workspace-network',
			workspace: 'Network',
			owner: 'NetOps',
			environment: 'production',
			region: 'sfo',
			os: 'VyOS',
			status: 'offline',
			cpuLoad: 0,
			memoryLoad: 0,
			riskScore: 89,
			lastSeenMinutes: 118,
			patchState: 'overdue',
			protocols: ['ssh'],
			tags: ['edge', 'wan']
		},
		{
			id: 'host-lon-stage-04',
			name: 'lon-stage-04',
			hostname: 'lon-stage-04.internal',
			workspaceId: 'workspace-product',
			workspace: 'Product',
			owner: 'Release',
			environment: 'staging',
			region: 'lon',
			os: 'Ubuntu 24.04',
			status: 'healthy',
			cpuLoad: 36,
			memoryLoad: 63,
			riskScore: 27,
			lastSeenMinutes: 7,
			patchState: 'due',
			protocols: ['ssh'],
			tags: ['release', 'canary']
		}
	],
	templates: [
		{
			id: 'template-patch-linux',
			name: 'Linux patch window',
			workspaceId: 'workspace-platform',
			category: 'Maintenance',
			description:
				'Apply package updates, restart affected services, and capture post-check evidence.',
			risk: 'medium',
			approvalRequired: true,
			estimatedDuration: '18m',
			lastRun: '2 days ago',
			parameters: ['maintenance window', 'reboot policy', 'service allowlist']
		},
		{
			id: 'template-cert-rotate',
			name: 'Certificate rotation',
			workspaceId: 'workspace-platform',
			category: 'Security',
			description:
				'Distribute renewed certificates and verify listeners before replacing the active bundle.',
			risk: 'high',
			approvalRequired: true,
			estimatedDuration: '9m',
			lastRun: '6 hours ago',
			parameters: ['certificate source', 'listener probe', 'rollback secret']
		},
		{
			id: 'template-inventory-sync',
			name: 'Inventory sync',
			workspaceId: null,
			category: 'Discovery',
			description: 'Refresh OS, protocol, tag, and workspace metadata from reachable hosts.',
			risk: 'low',
			approvalRequired: false,
			estimatedDuration: '4m',
			lastRun: '23 minutes ago',
			parameters: ['probe depth', 'tag overwrite mode']
		}
	],
	workspaces: [
		{ id: 'workspace-engineering', name: 'Engineering' },
		{ id: 'workspace-network', name: 'Network' },
		{ id: 'workspace-platform', name: 'Platform' },
		{ id: 'workspace-product', name: 'Product' },
		{ id: 'workspace-support', name: 'Support' }
	],
	bulkOperations: fleetBulkOperations,
	jobs: [
		{
			id: 'job-1842',
			name: 'Inventory sync',
			status: 'completed',
			startedAt: 'Today 09:42',
			duration: '3m 18s',
			targets: 84,
			successful: 82,
			failed: 2,
			requestedBy: 'jens',
			reportUrl: '/fleet/executions/job-1842'
		},
		{
			id: 'job-1841',
			name: 'Linux patch window',
			status: 'running',
			startedAt: 'Today 08:15',
			duration: '42m',
			targets: 12,
			successful: 8,
			failed: 0,
			requestedBy: 'ops-admin',
			reportUrl: '/fleet/executions/job-1841'
		},
		{
			id: 'job-1840',
			name: 'Rotate SSH keys',
			status: 'blocked',
			startedAt: 'Yesterday 22:03',
			duration: '0m',
			targets: 5,
			successful: 0,
			failed: 0,
			requestedBy: 'security',
			reportUrl: '/fleet/executions/job-1840'
		}
	],
	policies: [
		{
			id: 'policy-prod-bulk',
			name: 'Production bulk guardrail',
			scope: 'production hosts',
			status: 'pending',
			requestedBy: 'security',
			approver: 'SRE lead',
			dueAt: 'Today 17:00',
			impact:
				'Requires approval for high-risk operations touching more than three production hosts.'
		},
		{
			id: 'policy-rdp-clipboard',
			name: 'RDP clipboard approvals',
			scope: 'Support workspace',
			status: 'approved',
			requestedBy: 'helpdesk',
			approver: 'Compliance',
			dueAt: 'Approved yesterday',
			impact: 'Allows clipboard sync for audited support sessions only.'
		},
		{
			id: 'policy-maintenance-freeze',
			name: 'Maintenance freeze',
			scope: 'Network workspace',
			status: 'pending',
			requestedBy: 'netops',
			approver: 'Platform owner',
			dueAt: 'Tomorrow 09:00',
			impact: 'Blocks disruptive operations while edge reachability is degraded.'
		}
	]
};

export function filterFleetHosts(hosts: FleetHost[], filters: FleetHostFilters) {
	const needle = filters.search.trim().toLowerCase();

	return hosts.filter((host) => {
		if (filters.status !== 'all' && host.status !== filters.status) return false;
		if (filters.workspace !== 'all' && host.workspace !== filters.workspace) return false;
		if (filters.region !== 'all' && host.region !== filters.region) return false;
		if (filters.patchState !== 'all' && host.patchState !== filters.patchState) return false;
		if (!needle) return true;

		return [
			host.name,
			host.hostname,
			host.workspace,
			host.owner,
			host.environment,
			host.region,
			host.os,
			host.patchState,
			host.health?.label,
			host.health?.reason,
			...host.protocols,
			...host.tags
		]
			.join(' ')
			.toLowerCase()
			.includes(needle);
	});
}

export function uniqueFleetValues<T extends string>(values: T[]) {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function buildBulkOperationReview(
	operation: FleetBulkOperation | null | undefined,
	runbook: FleetAutomationTemplate | null | undefined,
	targets: FleetHost[]
): FleetTargetReview {
	const highRiskTargets = targets.filter((host) => hasFleetCriticalTargetTag(host.tags)).length;
	const offlineTargets = targets.filter(
		(host) => explainFleetTargetHealth(host).status === 'offline'
	).length;
	const attentionTargets = targets.filter(
		(host) => explainFleetTargetHealth(host).status === 'needs_attention'
	).length;
	const approvalRequired = Boolean(operation?.approvalRequired || runbook?.approvalRequired);
	const blockers: string[] = [];
	const warnings: string[] = [];

	if (!runbook) blockers.push('Choose a runbook.');
	if (!operation) blockers.push('Choose an operation.');
	if (!targets.length) blockers.push('Select at least one target.');
	if (offlineTargets > 0) blockers.push('Remove offline targets before running.');
	if (approvalRequired && targets.some((host) => !host.workspaceId)) {
		blockers.push(approvalWorkspaceTargetMessage);
	}
	if (approvalRequired && targetWorkspaceIds(targets).length > 1) {
		blockers.push(approvalWorkspaceScopeMessage);
	}
	if (!approvalRequired && hasMixedFleetScopes(targets)) {
		blockers.push(mixedExecutionScopeMessage);
	}
	if (attentionTargets > 0) warnings.push(formatFleetAttentionWarning(attentionTargets));
	if (highRiskTargets > 0) warnings.push(formatFleetHighRiskWarning(highRiskTargets));

	return {
		targetCount: targets.length,
		highRiskTargets,
		offlineTargets,
		approvalRequired,
		canRun: blockers.length === 0,
		ctaLabel: approvalRequired ? 'Submit for approval' : 'Queue execution',
		blockers,
		warnings
	};
}

function targetWorkspaceIds(targets: FleetHost[]): string[] {
	return [
		...new Set(targets.map((host) => host.workspaceId).filter((id): id is string => Boolean(id)))
	];
}

function hasMixedFleetScopes(targets: FleetHost[]): boolean {
	const scopes = new Set(
		targets.map((host) => (host.workspaceId ? `workspace:${host.workspaceId}` : 'personal'))
	);
	return scopes.size > 1;
}

export function explainFleetTargetHealth(host: FleetHost): FleetTargetHealthSummary {
	if (host.health) return host.health;
	if (host.status === 'healthy') {
		return {
			status: 'healthy',
			label: 'Healthy',
			reason: 'Recent successful activity and no blocking health signals.',
			sourceState: 'healthy',
			lastCheckedAt: null,
			nextCheckAt: null,
			lastSuccessfulConnectionAt: null,
			lastFailedConnectionAt: null,
			consecutiveFailures: 0,
			credentialSignal: 'ok',
			reachabilitySignal: 'reachable'
		};
	}
	if (host.status === 'offline') {
		return {
			status: 'offline',
			label: 'Offline',
			reason: 'The last health check could not reach or authenticate to this target.',
			sourceState: 'offline',
			lastCheckedAt: null,
			nextCheckAt: null,
			lastSuccessfulConnectionAt: null,
			lastFailedConnectionAt: null,
			consecutiveFailures: 1,
			credentialSignal: 'unknown',
			reachabilitySignal: 'unreachable'
		};
	}
	if (host.status === 'maintenance') {
		return {
			status: 'not_checked',
			label: 'Not checked',
			reason: 'No reliable health check has been recorded yet.',
			sourceState: 'unknown',
			lastCheckedAt: null,
			nextCheckAt: null,
			lastSuccessfulConnectionAt: null,
			lastFailedConnectionAt: null,
			consecutiveFailures: 0,
			credentialSignal: 'unknown',
			reachabilitySignal: 'unknown'
		};
	}
	return {
		status: 'needs_attention',
		label: 'Needs attention',
		reason: 'The target has a degraded or stale health signal.',
		sourceState: 'degraded',
		lastCheckedAt: null,
		nextCheckAt: null,
		lastSuccessfulConnectionAt: null,
		lastFailedConnectionAt: null,
		consecutiveFailures: 0,
		credentialSignal: 'unknown',
		reachabilitySignal: 'unknown'
	};
}

export function fleetStatusLabel(status: FleetHealthStatus) {
	const labels: Record<FleetHealthStatus, string> = {
		healthy: 'Healthy',
		degraded: 'Degraded',
		offline: 'Offline',
		maintenance: 'Maintenance'
	};
	return labels[status];
}

export function fleetRiskLabel(risk: FleetRiskLevel) {
	const labels: Record<FleetRiskLevel, string> = {
		low: 'Low',
		medium: 'Medium',
		high: 'High'
	};
	return labels[risk];
}
