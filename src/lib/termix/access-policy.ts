export const workspaceAccessRoles = ['viewer', 'operator', 'maintainer', 'owner'] as const;
export type WorkspaceAccessRole = (typeof workspaceAccessRoles)[number];

export const accessPolicyActions = [
	'view',
	'launch',
	'transfer',
	'tunnel',
	'record',
	'clipboard',
	'audio',
	'templates',
	'bulkJobs'
] as const;
export type AccessPolicyAction = (typeof accessPolicyActions)[number];

export type AccessDecisionState = 'allowed' | 'blocked' | 'approval_required' | 'reason_required';

export type AccessPolicyRequirementKind = 'approval' | 'reason' | 'review' | 'role';

export type AccessPolicyRequirement = {
	kind: AccessPolicyRequirementKind;
	code: string;
	message: string;
	satisfied: boolean;
};

export type AccessPolicyDecision = {
	action: AccessPolicyAction;
	allowed: boolean;
	state: AccessDecisionState;
	code: string;
	message: string;
	userRole: WorkspaceAccessRole;
	requiredRole: WorkspaceAccessRole;
	requirements: AccessPolicyRequirement[];
	ui: {
		blocked: boolean;
		state: AccessDecisionState;
		title: string;
		detail: string;
		requirements: string[];
	};
};

export type AccessActionRule = {
	enabled?: boolean;
	minRole?: WorkspaceAccessRole;
	requireApproval?: boolean;
	requireReason?: boolean;
};

export type AccessPolicy = {
	actionRules?: Partial<Record<AccessPolicyAction, AccessActionRule>>;
	sensitiveHosts?: {
		requireApproval?: boolean;
		requireReason?: boolean;
		appliesTo?: AccessPolicyAction[];
	};
	dangerousTemplates?: {
		requireApproval?: boolean;
		requireReason?: boolean;
	};
	bulkJobs?: {
		highHostCountThreshold?: number;
		maxHostCount?: number;
		requireApprovalAboveThreshold?: boolean;
		requireReasonAboveThreshold?: boolean;
		blockHiddenHosts?: boolean;
	};
	transfers?: {
		maxBytes?: number;
		allowRecursive?: boolean;
		riskyExtensions?: string[];
		riskyPathPrefixes?: string[];
		requireApprovalForRiskyTransfers?: boolean;
		requireReasonForRiskyTransfers?: boolean;
	};
};

export type AccessPolicyHostContext = {
	id?: string;
	name?: string;
	sensitive?: boolean;
	tags?: string[];
	metadata?: Record<string, unknown>;
};

export type AccessPolicyTemplateContext = {
	id?: string;
	name?: string;
	dangerous?: boolean;
	riskLevel?: 'low' | 'medium' | 'high' | 'critical';
	metadata?: Record<string, unknown>;
};

export type AccessPolicyTransferContext = {
	direction?: 'upload' | 'download' | 'remote-to-remote';
	bytes?: number;
	path?: string;
	recursive?: boolean;
	overwritesExisting?: boolean;
	deletesBeforeTransfer?: boolean;
	executable?: boolean;
};

export type AccessPolicySelectionContext = {
	hostCount?: number;
	hiddenHostCount?: number;
};

export type AccessPolicyEvaluationInput = {
	action: AccessPolicyAction;
	role: WorkspaceAccessRole;
	policy?: AccessPolicy | null;
	host?: AccessPolicyHostContext | null;
	template?: AccessPolicyTemplateContext | null;
	transfer?: AccessPolicyTransferContext | null;
	selection?: AccessPolicySelectionContext | null;
	approval?: boolean | { approved: boolean } | null;
	reason?: string | null;
};

const roleRank: Record<WorkspaceAccessRole, number> = {
	viewer: 0,
	operator: 1,
	maintainer: 2,
	owner: 3
};

const defaultMinimumRoles: Record<AccessPolicyAction, WorkspaceAccessRole> = {
	view: 'viewer',
	launch: 'operator',
	transfer: 'operator',
	tunnel: 'maintainer',
	record: 'maintainer',
	clipboard: 'operator',
	audio: 'operator',
	templates: 'maintainer',
	bulkJobs: 'maintainer'
};

const actionLabels: Record<AccessPolicyAction, string> = {
	view: 'View hosts',
	launch: 'Launch sessions',
	transfer: 'Transfer files',
	tunnel: 'Open SSH tunnels',
	record: 'Record terminals',
	clipboard: 'Use clipboard',
	audio: 'Use RDP audio',
	templates: 'Run templates',
	bulkJobs: 'Start bulk jobs'
};

const defaultSensitiveHostActions = accessPolicyActions.filter((action) => action !== 'view');

export function canRolePerformAction(
	role: WorkspaceAccessRole,
	action: AccessPolicyAction,
	policy: AccessPolicy | null = null
): boolean {
	const rule = policy?.actionRules?.[action];
	if (rule?.enabled === false) return false;
	return roleRank[role] >= roleRank[rule?.minRole ?? defaultMinimumRoles[action]];
}

export function evaluateAccessPolicy(input: AccessPolicyEvaluationInput): AccessPolicyDecision {
	const rule = input.policy?.actionRules?.[input.action];
	const requiredRole = rule?.minRole ?? defaultMinimumRoles[input.action];
	const requirements = collectRequirements(input, requiredRole);
	const blockedRequirement = requirements.find((requirement) => !requirement.satisfied);

	if (rule?.enabled === false) {
		return blockedDecision(input, requiredRole, requirements, {
			code: 'policy_action_disabled',
			message: `${actionLabels[input.action]} is disabled by workspace policy.`
		});
	}

	if (roleRank[input.role] < roleRank[requiredRole]) {
		return blockedDecision(input, requiredRole, requirements, {
			code: 'policy_role_denied',
			message: `${actionLabels[input.action]} requires the ${requiredRole} role.`
		});
	}

	if (blockedRequirement) {
		const state = blockedRequirementState(blockedRequirement);
		return {
			action: input.action,
			allowed: false,
			state,
			code: blockedRequirement.code,
			message: blockedRequirement.message,
			userRole: input.role,
			requiredRole,
			requirements,
			ui: buildUiState(input.action, state, blockedRequirement.message, requirements)
		};
	}

	const message = `${actionLabels[input.action]} is allowed.`;
	return {
		action: input.action,
		allowed: true,
		state: 'allowed',
		code: 'policy_allowed',
		message,
		userRole: input.role,
		requiredRole,
		requirements,
		ui: buildUiState(input.action, 'allowed', message, requirements)
	};
}

export function isSensitiveHost(host: AccessPolicyHostContext | null | undefined): boolean {
	if (!host) return false;
	if (host.sensitive) return true;
	if (host.tags?.some((tag) => normalizeToken(tag) === 'sensitive')) return true;
	const metadata = host.metadata ?? {};
	return (
		metadata.sensitive === true ||
		normalizeToken(metadata.classification) === 'sensitive' ||
		normalizeToken(metadata.criticality) === 'high'
	);
}

export function isDangerousTemplate(
	template: AccessPolicyTemplateContext | null | undefined
): boolean {
	if (!template) return false;
	if (template.dangerous) return true;
	if (template.riskLevel === 'high' || template.riskLevel === 'critical') return true;
	const metadata = template.metadata ?? {};
	return metadata.dangerous === true || normalizeToken(metadata.riskLevel) === 'critical';
}

export function isRiskyTransfer(
	transfer: AccessPolicyTransferContext | null | undefined,
	policy: AccessPolicy | null = null
): boolean {
	if (!transfer) return false;
	if (transfer.recursive && policy?.transfers?.allowRecursive === false) return true;
	if (transfer.overwritesExisting || transfer.deletesBeforeTransfer || transfer.executable) {
		return true;
	}
	if (typeof transfer.bytes === 'number' && typeof policy?.transfers?.maxBytes === 'number') {
		if (transfer.bytes > policy.transfers.maxBytes) return true;
	}

	const normalizedPath = normalizePath(transfer.path);
	if (!normalizedPath) return false;

	const riskyPrefixes = policy?.transfers?.riskyPathPrefixes ?? [
		'/etc/',
		'/root/',
		'/var/lib/',
		'/usr/local/bin/',
		'C:\\Windows\\',
		'C:\\Program Files\\'
	];
	if (riskyPrefixes.some((prefix) => normalizedPath.startsWith(normalizePath(prefix)))) {
		return true;
	}

	const riskyExtensions = policy?.transfers?.riskyExtensions ?? [
		'.sh',
		'.ps1',
		'.bat',
		'.cmd',
		'.service',
		'.timer',
		'.conf'
	];
	return riskyExtensions.some((extension) =>
		normalizedPath.endsWith(extension.toLocaleLowerCase())
	);
}

function collectRequirements(
	input: AccessPolicyEvaluationInput,
	requiredRole: WorkspaceAccessRole
): AccessPolicyRequirement[] {
	const requirements: AccessPolicyRequirement[] = [
		{
			kind: 'role',
			code: 'role_required',
			message: `Requires ${requiredRole} role or higher.`,
			satisfied: roleRank[input.role] >= roleRank[requiredRole]
		}
	];
	const rule = input.policy?.actionRules?.[input.action];

	if (rule?.requireApproval) {
		requirements.push(approvalRequirement(input.approval, 'action_approval_required'));
	}
	if (rule?.requireReason) {
		requirements.push(reasonRequirement(input.reason, 'action_reason_required'));
	}

	if (isSensitiveHost(input.host) && sensitiveHostPolicyApplies(input)) {
		const sensitivePolicy = input.policy?.sensitiveHosts;
		if (sensitivePolicy?.requireApproval) {
			requirements.push(approvalRequirement(input.approval, 'sensitive_host_approval_required'));
		}
		if (sensitivePolicy?.requireReason ?? true) {
			requirements.push(reasonRequirement(input.reason, 'sensitive_host_reason_required'));
		}
	}

	if (input.action === 'templates' && isDangerousTemplate(input.template)) {
		const templatePolicy = input.policy?.dangerousTemplates;
		if (templatePolicy?.requireApproval ?? true) {
			requirements.push(
				approvalRequirement(input.approval, 'dangerous_template_approval_required')
			);
		}
		if (templatePolicy?.requireReason ?? true) {
			requirements.push(reasonRequirement(input.reason, 'dangerous_template_reason_required'));
		}
	}

	if (input.action === 'bulkJobs') {
		collectBulkJobRequirements(input, requirements);
	}

	if (input.action === 'transfer' && isRiskyTransfer(input.transfer, input.policy)) {
		const transferPolicy = input.policy?.transfers;
		if (transferPolicy?.requireApprovalForRiskyTransfers ?? true) {
			requirements.push(approvalRequirement(input.approval, 'risky_transfer_approval_required'));
		}
		if (transferPolicy?.requireReasonForRiskyTransfers ?? true) {
			requirements.push(reasonRequirement(input.reason, 'risky_transfer_reason_required'));
		}
	}

	return deduplicateRequirements(requirements);
}

function collectBulkJobRequirements(
	input: AccessPolicyEvaluationInput,
	requirements: AccessPolicyRequirement[]
): void {
	const hostCount = input.selection?.hostCount ?? 0;
	const hiddenHostCount = input.selection?.hiddenHostCount ?? 0;
	const policy = input.policy?.bulkJobs;
	const highHostCountThreshold = policy?.highHostCountThreshold ?? 25;

	if ((policy?.blockHiddenHosts ?? true) && hiddenHostCount > 0) {
		requirements.push({
			kind: 'review',
			code: 'hidden_hosts_blocked',
			message: 'Bulk jobs cannot include hosts hidden from the reviewed selection.',
			satisfied: false
		});
	}

	if (typeof policy?.maxHostCount === 'number' && hostCount > policy.maxHostCount) {
		requirements.push({
			kind: 'review',
			code: 'bulk_host_count_exceeded',
			message: `Bulk jobs are limited to ${policy.maxHostCount} hosts by workspace policy.`,
			satisfied: false
		});
	}

	if (hostCount > highHostCountThreshold) {
		if (policy?.requireApprovalAboveThreshold ?? true) {
			requirements.push(approvalRequirement(input.approval, 'high_host_count_approval_required'));
		}
		if (policy?.requireReasonAboveThreshold ?? true) {
			requirements.push(reasonRequirement(input.reason, 'high_host_count_reason_required'));
		}
	}
}

function blockedDecision(
	input: AccessPolicyEvaluationInput,
	requiredRole: WorkspaceAccessRole,
	requirements: AccessPolicyRequirement[],
	blocked: { code: string; message: string }
): AccessPolicyDecision {
	return {
		action: input.action,
		allowed: false,
		state: 'blocked',
		code: blocked.code,
		message: blocked.message,
		userRole: input.role,
		requiredRole,
		requirements,
		ui: buildUiState(input.action, 'blocked', blocked.message, requirements)
	};
}

function approvalRequirement(
	approval: AccessPolicyEvaluationInput['approval'],
	code: string
): AccessPolicyRequirement {
	return {
		kind: 'approval',
		code,
		message: 'Approval is required by workspace policy.',
		satisfied: hasApproval(approval)
	};
}

function reasonRequirement(
	reason: string | null | undefined,
	code: string
): AccessPolicyRequirement {
	return {
		kind: 'reason',
		code,
		message: 'A reason is required by workspace policy.',
		satisfied: typeof reason === 'string' && reason.trim().length > 0
	};
}

function deduplicateRequirements(
	requirements: AccessPolicyRequirement[]
): AccessPolicyRequirement[] {
	const deduplicated = new Map<string, AccessPolicyRequirement>();
	for (const requirement of requirements) {
		const existing = deduplicated.get(requirement.code);
		if (!existing || existing.satisfied) {
			deduplicated.set(requirement.code, requirement);
		}
	}
	return [...deduplicated.values()];
}

function buildUiState(
	action: AccessPolicyAction,
	state: AccessDecisionState,
	detail: string,
	requirements: AccessPolicyRequirement[]
): AccessPolicyDecision['ui'] {
	return {
		blocked: state !== 'allowed',
		state,
		title: actionLabels[action],
		detail,
		requirements: requirements
			.filter((requirement) => !requirement.satisfied)
			.map((requirement) => requirement.message)
	};
}

function blockedRequirementState(requirement: AccessPolicyRequirement): AccessDecisionState {
	if (requirement.kind === 'approval') return 'approval_required';
	if (requirement.kind === 'reason') return 'reason_required';
	return 'blocked';
}

function hasApproval(approval: AccessPolicyEvaluationInput['approval']): boolean {
	if (typeof approval === 'boolean') return approval;
	return approval?.approved === true;
}

function sensitiveHostPolicyApplies(input: AccessPolicyEvaluationInput): boolean {
	const actions = input.policy?.sensitiveHosts?.appliesTo ?? defaultSensitiveHostActions;
	return actions.includes(input.action);
}

function normalizeToken(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function normalizePath(value: unknown): string {
	return typeof value === 'string' ? value.trim().replaceAll('\\', '/').toLocaleLowerCase() : '';
}
