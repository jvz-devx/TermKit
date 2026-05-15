import { command, getRequestEvent, query } from '$app/server';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import { hostService } from '$lib/server/services/hosts';
import { v6ResourcesService } from '$lib/server/services/v6-resources';
import { workspaceService } from '$lib/server/services/workspaces';
import {
	builtInAutomationTemplates,
	type AutomationTemplateKind as BuiltInTemplateKind
} from '$lib/termix/automation-template';
import {
	fleetBulkOperations,
	formatFleetAttentionWarning,
	formatFleetHighRiskWarning,
	hasFleetCriticalTargetTag,
	resolveFleetBulkOperationContract
} from '$lib/termix/fleet-contracts';
import type {
	FleetApprovalStatus,
	FleetAutomationTemplate,
	FleetExecutionPreflight,
	FleetExecutionSubmitResult,
	FleetHealthStatus,
	FleetHost,
	FleetJob,
	FleetJobStatus,
	FleetOverview,
	FleetRunbooksData,
	FleetTargetHealthSummary
} from '$lib/components/termix/fleet/fleet-data';
import type { HostRecord, WorkspaceRecord } from '$lib/server/services/types';
import type {
	AutomationTemplateKind,
	AutomationTemplateRecord,
	BackgroundJobRecord,
	HostFactsRecord,
	HostHealthRecord,
	WorkspacePolicyRole
} from '$lib/server/services/v6-resources';

export type CreateFleetAutomationTemplateInput = {
	name?: unknown;
	kind?: unknown;
	visibility?: unknown;
	workspaceId?: unknown;
	description?: unknown;
	body?: unknown;
	variables?: unknown;
	dangerous?: unknown;
};

export type QueueFleetBulkOperationInput = {
	operationId?: unknown;
	templateId?: unknown;
	targetHostIds?: unknown;
	reason?: unknown;
	concurrencyLimit?: unknown;
};

export type PreflightFleetExecutionInput = QueueFleetBulkOperationInput;

export type DecideFleetApprovalInput = {
	approvalId?: unknown;
	status?: unknown;
	reason?: unknown;
};

export const getFleetOverview = query(loadFleetOverview);

export const getFleetRunbooks = query(loadFleetRunbooks);
export const getFleetTargets = query(async () => (await loadFleetOverview()).hosts);
export const getFleetExecutions = query(async () => (await loadFleetOverview()).jobs);
export const getFleetApprovals = query(async () => (await loadFleetOverview()).policies);

const approvalWorkspaceTargetMessage =
	'approval-required executions require every target to belong to a workspace';
const approvalWorkspaceScopeMessage =
	'approval-required executions must target one workspace at a time until approval requests can be created atomically.';
const mixedExecutionScopeMessage =
	'Select targets from one workspace or personal scope; mixed-scope executions are blocked until job history supports multiple scopes.';

async function loadFleetOverview(): Promise<FleetOverview> {
	const user = requireRemoteUser();
	const [hosts, workspaces] = await Promise.all([
		hostService.list(user.id),
		workspaceService.list(user.id)
	]);
	const workspaceIds = workspaces.map((workspace) => workspace.id);
	const hostIds = hosts.map((host) => host.id);
	const [templates, jobs, approvals, facts, health] = await Promise.all([
		v6ResourcesService.listAutomationTemplates(user.id, workspaceIds),
		v6ResourcesService.listBackgroundJobs(user.id, workspaceIds),
		v6ResourcesService.listApprovalRequests(user.id, workspaceIds),
		v6ResourcesService.listHostFacts(hostIds),
		v6ResourcesService.listHostHealth(hostIds)
	]);
	const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
	const factsByHost = new Map(facts.map((record) => [record.hostId, record]));
	const healthByHost = new Map(health.map((record) => [record.hostId, record]));

	return {
		workspaces: toFleetWorkspaces(workspaces),
		hosts: hosts.map((host) =>
			toFleetHost(
				host,
				workspacesById.get(host.workspaceId ?? ''),
				factsByHost.get(host.id),
				healthByHost.get(host.id)
			)
		),
		templates: toFleetTemplates(templates),
		bulkOperations: fleetBulkOperations,
		jobs: jobs.map(toFleetJob).sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
		policies: approvals.map((approval) => ({
			id: approval.id,
			name: `${approval.capability.replaceAll('_', ' ')} approval`,
			scope: approval.workspaceId
				? (workspacesById.get(approval.workspaceId)?.name ?? 'Workspace')
				: 'Personal',
			status: toFleetApprovalStatus(approval.status),
			requestedBy: approval.requestedBy,
			approver: approval.decidedBy ?? 'Pending',
			dueAt: approval.expiresAt?.toISOString() ?? 'No expiry',
			impact: approval.reason ?? 'No reason provided'
		}))
	};
}

async function loadFleetRunbooks(): Promise<FleetRunbooksData> {
	const user = requireRemoteUser();
	const workspaces = await workspaceService.list(user.id);
	const workspaceIds = workspaces.map((workspace) => workspace.id);
	const templates = await v6ResourcesService.listAutomationTemplates(user.id, workspaceIds);

	return {
		workspaces: toFleetWorkspaces(workspaces),
		templates: toFleetTemplates(templates)
	};
}

export const createFleetAutomationTemplate = command<
	CreateFleetAutomationTemplateInput,
	FleetAutomationTemplate
>('unchecked', async (input) => {
	const user = requireRemoteUser();
	const kind = requireTemplateKind(input.kind);
	const variableNames = normalizeVariableNames(input.variables);
	const workspaceId = input.visibility === 'workspace' ? asTrimmedString(input.workspaceId) : null;
	if (input.visibility === 'workspace' && !workspaceId) {
		throw new ServiceValidationError(['workspace visibility requires workspaceId']);
	}
	if (workspaceId) {
		await workspaceService.assertMember(user.id, workspaceId);
	}
	const template = await v6ResourcesService.createAutomationTemplate(user.id, {
		name: requireName(input.name),
		kind,
		visibility: input.visibility === 'workspace' ? 'workspace' : 'private',
		workspaceId,
		description: asTrimmedString(input.description) ?? `${kind.replaceAll('_', ' ')} template`,
		definition: {
			body: asTrimmedString(input.body) ?? defaultTemplateBody(kind, variableNames)
		},
		variables: variableNames.map((name) => ({ name, kind: 'string' as const, required: true })),
		isDangerous: input.dangerous === true,
		metadata: { source: 'fleet-ui' }
	});
	refreshFleetQueries();
	return toFleetTemplate(template);
});

export const preflightFleetExecution = command<
	PreflightFleetExecutionInput,
	FleetExecutionPreflight
>('unchecked', async (input) => {
	const { operation, operationId, template, templateId, targetHostIds, targetHosts, policy } =
		await prepareExecutionReview(input);
	const highRiskTargets = targetHosts.filter((host) => hasFleetCriticalTargetTag(host.tags)).length;
	const health = await v6ResourcesService.listHostHealth(targetHostIds);
	const healthByHost = new Map(health.map((record) => [record.hostId, record]));
	const offlineTargets = targetHosts.filter((host) => {
		const state = healthByHost.get(host.id)?.state;
		return state === 'unreachable' || state === 'auth_failed';
	}).length;
	const attentionTargets = targetHosts.filter((host) => {
		const state = healthByHost.get(host.id)?.state;
		return state === 'stale' || state === 'degraded';
	}).length;
	const blockers: string[] = [];
	const warnings: string[] = [];

	if (offlineTargets > 0) blockers.push('Remove offline targets before running.');
	if (attentionTargets > 0) warnings.push(formatFleetAttentionWarning(attentionTargets));
	if (highRiskTargets > 0) warnings.push(formatFleetHighRiskWarning(highRiskTargets));
	const approvalRequired =
		policy.approvalRequired || operation.approvalRequired || template.requiresApproval;
	if (policy.blockedReason) blockers.push(policy.blockedReason);
	if (approvalRequired && !allTargetsHaveWorkspace(targetHosts)) {
		blockers.push(approvalWorkspaceTargetMessage);
	}
	if (approvalRequired && targetWorkspaceIds(targetHosts).length > 1) {
		blockers.push(approvalWorkspaceScopeMessage);
	}
	if (!approvalRequired && hasMixedExecutionScopes(targetHosts)) {
		blockers.push(mixedExecutionScopeMessage);
	}

	return {
		runbookId: templateId,
		operationId,
		targetHostIds,
		targetCount: targetHostIds.length,
		highRiskTargets,
		offlineTargets,
		approvalRequired,
		canRun: blockers.length === 0,
		ctaLabel: approvalRequired ? 'Submit for approval' : 'Queue execution',
		blockers,
		warnings
	};
});

export const queueFleetBulkOperation = command<
	QueueFleetBulkOperationInput,
	FleetExecutionSubmitResult
>('unchecked', async (input) => {
	const { user, operation, operationId, template, templateId, targetHostIds, targetHosts, policy } =
		await prepareExecutionReview(input);
	if (policy.blockedReason) {
		throw new ServiceValidationError([policy.blockedReason]);
	}
	const approvalRequired =
		policy.approvalRequired || operation.approvalRequired || template.requiresApproval;
	if (approvalRequired && !allTargetsHaveWorkspace(targetHosts)) {
		throw new ServiceValidationError([approvalWorkspaceTargetMessage]);
	}
	if (approvalRequired && targetWorkspaceIds(targetHosts).length > 1) {
		throw new ServiceValidationError([approvalWorkspaceScopeMessage]);
	}
	if (!approvalRequired && hasMixedExecutionScopes(targetHosts)) {
		throw new ServiceValidationError([mixedExecutionScopeMessage]);
	}
	if (approvalRequired) {
		const approvalReason = asTrimmedString(input.reason) ?? `${operationId} requires approval`;
		await requestBulkJobApprovals(user.id, targetHosts, {
			reason: approvalReason,
			operationId
		});
		await ignoreReasonRecordFailure(recordBulkJobReason(user.id, targetHosts, approvalReason));
		refreshFleetQueries();
		return {
			status: 'approval_requested',
			message: 'Approval request submitted before this execution can run.'
		};
	}

	await recordBulkJobReason(user.id, targetHosts, asTrimmedString(input.reason));
	const result = await v6ResourcesService.createBackgroundJob(user.id, {
		workspaceId: targetHosts[0]?.workspaceId ?? null,
		templateId,
		templateVersion: template.version,
		kind: operation.jobKind,
		title: operation.jobTitle,
		request: {
			operationId,
			templateId,
			reviewedHostIds: targetHostIds,
			secretPolicy: operation.secretPolicy
		},
		targetHostIds,
		concurrencyLimit: normalizeConcurrency(input.concurrencyLimit),
		reason: asTrimmedString(input.reason) ?? 'Reviewed from fleet operations'
	});
	refreshFleetQueries();
	return {
		status: 'queued',
		job: toFleetJob(result.job),
		message: 'Execution queued.'
	};
});

export const decideFleetApproval = command<DecideFleetApprovalInput, void>(
	'unchecked',
	async (input) => {
		const user = requireRemoteUser();
		const approvalId = requireId(input.approvalId, 'approvalId');
		const status = input.status === 'approved' || input.status === 'rejected' ? input.status : null;
		if (!status) {
			throw new ServiceValidationError(['status must be approved or rejected']);
		}
		await v6ResourcesService.decideApproval(
			approvalId,
			user.id,
			status,
			asTrimmedString(input.reason) ?? `${status} from fleet operations`
		);
		refreshFleetQueries();
	}
);

function refreshFleetQueries() {
	void getFleetOverview().refresh();
	void getFleetRunbooks().refresh();
	void getFleetTargets().refresh();
	void getFleetExecutions().refresh();
	void getFleetApprovals().refresh();
}

function requireRemoteUser(): { id: string; username: string } {
	const user = getRequestEvent().locals.user;
	if (!user) throw new ServiceUnauthorizedError();
	return { id: user.id, username: user.username };
}

function toFleetHost(
	host: HostRecord,
	workspace: WorkspaceRecord | undefined,
	facts: HostFactsRecord | undefined,
	health: HostHealthRecord | undefined
): FleetHost {
	const status = toFleetHealthStatus(health?.state);
	return {
		id: host.id,
		name: host.name,
		hostname: host.hostname,
		workspace: workspace?.name ?? 'Personal',
		workspaceId: host.workspaceId,
		owner: host.username ?? 'Unassigned',
		environment: host.tags.includes('production')
			? 'production'
			: host.tags.includes('staging')
				? 'staging'
				: 'development',
		region: regionFromHost(host),
		os: facts?.osName ?? host.metadata.osName?.toString() ?? 'Unknown',
		status,
		cpuLoad: Number(host.metadata.cpuLoad ?? 0),
		memoryLoad: Number(
			(facts?.memory as { usedPercent?: unknown } | undefined)?.usedPercent ??
				host.metadata.memoryLoad ??
				0
		),
		riskScore: host.tags.includes('critical') ? 80 : status === 'healthy' ? 25 : 65,
		lastSeenMinutes: minutesSince(health?.checkedAt),
		patchState: status === 'healthy' ? 'current' : status === 'offline' ? 'overdue' : 'due',
		protocols: [host.protocol, ...(host.protocol === 'ssh' ? ['sftp'] : [])],
		tags: host.tags,
		health: toFleetTargetHealth(health)
	};
}

async function prepareExecutionReview(input: PreflightFleetExecutionInput): Promise<{
	user: { id: string; username: string };
	operation: NonNullable<ReturnType<typeof resolveFleetBulkOperationContract>>;
	operationId: string;
	template: { id: string; version: number; requiresApproval: boolean };
	templateId: string;
	targetHostIds: string[];
	targetHosts: HostRecord[];
	policy: { approvalRequired: boolean; blockedReason: string | null };
}> {
	const user = requireRemoteUser();
	const operationId = requireId(input.operationId, 'operationId');
	const templateId = requireId(input.templateId, 'templateId');
	const operation = resolveFleetBulkOperationContract(operationId);
	if (!operation) {
		throw new ServiceValidationError(['operationId must be a supported fleet bulk operation']);
	}
	const targetHostIds = requireTargetHostIds(input.targetHostIds);
	const visibleHosts = await hostService.list(user.id);
	const visibleHostIds = new Set(visibleHosts.map((host) => host.id));
	const hiddenHostIds = targetHostIds.filter((hostId) => !visibleHostIds.has(hostId));
	if (hiddenHostIds.length > 0) {
		throw new ServiceValidationError(['targetHostIds must only include visible hosts']);
	}
	const workspaces = await workspaceService.list(user.id);
	const template = await resolveExecutionTemplate(
		user.id,
		workspaces.map((workspace) => workspace.id),
		templateId
	);
	const targetHosts = visibleHosts.filter((host) => targetHostIds.includes(host.id));
	const policy = await evaluateBulkJobPolicies(user.id, targetHosts, {
		reason: asTrimmedString(input.reason),
		operationId
	});
	return { user, operation, operationId, template, templateId, targetHostIds, targetHosts, policy };
}

async function resolveExecutionTemplate(
	userId: string,
	workspaceIds: string[],
	templateId: string
): Promise<{ id: string; version: number; requiresApproval: boolean }> {
	const builtInTemplate = builtInAutomationTemplates.find((template) => template.id === templateId);
	if (builtInTemplate) {
		return {
			id: builtInTemplate.id,
			version: 1,
			requiresApproval:
				builtInTemplate.kind === 'file_transfer' || builtInTemplate.kind === 'ssh_tunnel'
		};
	}

	const templates = await v6ResourcesService.listAutomationTemplates(userId, workspaceIds);
	const template = templates.find((candidate) => candidate.id === templateId);
	if (!template) {
		throw new ServiceValidationError(['templateId must reference a visible runbook']);
	}
	return {
		id: template.id,
		version: template.version,
		requiresApproval: template.requiresApproval
	};
}

function allTargetsHaveWorkspace(targetHosts: HostRecord[]): boolean {
	return targetHosts.every((host) => Boolean(host.workspaceId));
}

function targetWorkspaceIds(targetHosts: HostRecord[]): string[] {
	return [
		...new Set(
			targetHosts.map((host) => host.workspaceId).filter((id): id is string => Boolean(id))
		)
	];
}

function targetExecutionScopes(targetHosts: HostRecord[]): string[] {
	return [
		...new Set(
			targetHosts.map((host) => (host.workspaceId ? `workspace:${host.workspaceId}` : 'personal'))
		)
	];
}

function hasMixedExecutionScopes(targetHosts: HostRecord[]): boolean {
	return targetExecutionScopes(targetHosts).length > 1;
}

async function evaluateBulkJobPolicies(
	userId: string,
	targetHosts: HostRecord[],
	input: { reason: string | null; operationId: string }
): Promise<{ approvalRequired: boolean; blockedReason: string | null }> {
	let approvalRequired = false;
	const workspaceIds = [
		...new Set(
			targetHosts.map((host) => host.workspaceId).filter((id): id is string => Boolean(id))
		)
	];
	for (const workspaceId of workspaceIds) {
		const membership = await workspaceService.assertMember(userId, workspaceId);
		const targetCount = targetHosts.filter((host) => host.workspaceId === workspaceId).length;
		const decision = await v6ResourcesService.evaluateWorkspacePolicy({
			workspaceId,
			capability: 'bulk_job',
			role: membership.role as WorkspacePolicyRole,
			targetCount,
			reason: input.reason
		});
		if (decision.approvalRequired) {
			approvalRequired = true;
			continue;
		}
		if (!decision.allowed) {
			return {
				approvalRequired,
				blockedReason: decision.blockedReason ?? 'bulk job is blocked by policy'
			};
		}
	}
	return { approvalRequired, blockedReason: null };
}

async function recordBulkJobReason(
	userId: string,
	targetHosts: HostRecord[],
	reason: string | null
) {
	if (!reason) return;
	const workspaceIds = targetWorkspaceIds(targetHosts);
	if (workspaceIds.length === 0) {
		await v6ResourcesService.recordOperationReason(userId, {
			workspaceId: null,
			capability: 'bulk_job',
			reason
		});
		return;
	}
	await Promise.all(
		workspaceIds.map((workspaceId) =>
			v6ResourcesService.recordOperationReason(userId, {
				workspaceId,
				capability: 'bulk_job',
				reason
			})
		)
	);
}

async function ignoreReasonRecordFailure(recording: Promise<void>) {
	try {
		await recording;
	} catch {
		// Approval creation is the durable side effect; reason history must not mask that result.
	}
}

async function requestBulkJobApprovals(
	userId: string,
	targetHosts: HostRecord[],
	input: { reason: string | null; operationId: string }
) {
	const workspaceIds = targetWorkspaceIds(targetHosts);
	if (workspaceIds.length === 0) {
		throw new ServiceValidationError([approvalWorkspaceTargetMessage]);
	}
	if (workspaceIds.length > 1) {
		throw new ServiceValidationError([approvalWorkspaceScopeMessage]);
	}
	await Promise.all(
		workspaceIds.map((workspaceId) =>
			v6ResourcesService.requestApproval(userId, {
				workspaceId,
				capability: 'bulk_job',
				reason: input.reason ?? `${input.operationId} requires approval`
			})
		)
	);
}

function toFleetTargetHealth(health: HostHealthRecord | undefined): FleetTargetHealthSummary {
	if (!health) {
		return {
			status: 'not_checked',
			label: 'Not checked',
			reason: 'No health check has been recorded for this target.',
			sourceState: 'missing',
			lastCheckedAt: null,
			nextCheckAt: null,
			lastSuccessfulConnectionAt: null,
			lastFailedConnectionAt: null,
			consecutiveFailures: 0,
			credentialSignal: 'unknown',
			reachabilitySignal: 'unknown'
		};
	}
	const lastCheckedAt = health.checkedAt?.toISOString() ?? null;
	const base = {
		sourceState: health.state,
		lastCheckedAt,
		nextCheckAt: health.nextCheckAt?.toISOString() ?? null,
		lastSuccessfulConnectionAt: health.lastSuccessfulConnectionAt?.toISOString() ?? null,
		lastFailedConnectionAt: health.lastFailedConnectionAt?.toISOString() ?? null,
		consecutiveFailures: health.consecutiveFailures ?? 0
	};
	if (health.state === 'healthy') {
		return {
			...base,
			status: 'healthy',
			label: 'Healthy',
			reason: 'Recent successful activity and no blocking health signals.',
			credentialSignal: 'ok',
			reachabilitySignal: 'reachable'
		};
	}
	if (health.state === 'unreachable') {
		return {
			...base,
			status: 'offline',
			label: 'Offline',
			reason: health.failureReason ?? 'The target could not be reached during the last check.',
			credentialSignal: 'unknown',
			reachabilitySignal: 'unreachable'
		};
	}
	if (health.state === 'auth_failed') {
		return {
			...base,
			status: 'offline',
			label: 'Credential failed',
			reason: health.failureReason ?? 'The assigned credential failed during the last check.',
			credentialSignal: 'failed',
			reachabilitySignal: 'reachable'
		};
	}
	if (health.state === 'never_used' || health.state === 'unknown') {
		return {
			...base,
			status: 'not_checked',
			label: 'Not checked',
			reason: 'No successful connection or reliable health check has been recorded yet.',
			credentialSignal: 'unknown',
			reachabilitySignal: 'unknown'
		};
	}
	return {
		...base,
		status: 'needs_attention',
		label: health.state === 'stale' ? 'Stale check' : 'Needs attention',
		reason: health.failureReason ?? 'The latest health signal needs operator review.',
		credentialSignal: 'unknown',
		reachabilitySignal: 'unknown'
	};
}

function toBuiltInFleetTemplate(
	template: (typeof builtInAutomationTemplates)[number]
): FleetAutomationTemplate {
	return {
		id: template.id,
		name: template.name,
		workspaceId: template.workspaceId,
		category: template.kind.replaceAll('_', ' '),
		description: template.description,
		risk: template.kind === 'file_transfer' || template.kind === 'ssh_tunnel' ? 'medium' : 'low',
		approvalRequired: template.kind === 'file_transfer' || template.kind === 'ssh_tunnel',
		estimatedDuration: 'preview',
		lastRun: 'built-in',
		parameters: template.variables.map((variable) => variable.key)
	};
}

function toFleetWorkspaces(workspaces: WorkspaceRecord[]) {
	return workspaces
		.map((workspace) => ({ id: workspace.id, name: workspace.name }))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function toFleetTemplates(templates: AutomationTemplateRecord[]) {
	return [
		...builtInAutomationTemplates.map(toBuiltInFleetTemplate),
		...templates.map(toFleetTemplate)
	].sort((left, right) => left.name.localeCompare(right.name));
}

function toFleetTemplate(template: AutomationTemplateRecord): FleetAutomationTemplate {
	return {
		id: template.id,
		name: template.name,
		workspaceId: template.workspaceId,
		category: template.kind.replaceAll('_', ' '),
		description: template.description ?? 'Workspace automation template',
		risk: template.isDangerous ? 'high' : template.requiresApproval ? 'medium' : 'low',
		approvalRequired: template.requiresApproval,
		estimatedDuration: 'queued',
		lastRun: template.lastUsedAt?.toISOString() ?? 'Never',
		parameters: template.variables.map((variable) => variable.name)
	};
}

function toFleetJob(job: BackgroundJobRecord): FleetJob {
	return {
		id: job.id,
		name: job.title,
		status: toFleetJobStatus(job.status),
		startedAt: (job.startedAt ?? job.createdAt).toISOString(),
		duration:
			job.finishedAt && job.startedAt
				? `${Math.max(0, Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000))}s`
				: 'pending',
		targets: job.targetCount,
		successful: job.completedCount,
		failed: job.failedCount,
		requestedBy: job.userId,
		reportUrl: `/fleet/executions/${job.id}`
	};
}

function toFleetHealthStatus(state: HostHealthRecord['state'] | undefined): FleetHealthStatus {
	if (state === 'healthy') return 'healthy';
	if (state === 'unreachable' || state === 'auth_failed') return 'offline';
	if (state === 'never_used' || state === 'unknown') return 'maintenance';
	return 'degraded';
}

function toFleetJobStatus(status: BackgroundJobRecord['status']): FleetJobStatus {
	if (status === 'completed' || status === 'completed_with_errors') return 'completed';
	if (status === 'failed') return 'failed';
	if (status === 'running' || status === 'cancelling') return 'running';
	if (status === 'cancelled') return 'blocked';
	return 'queued';
}

function toFleetApprovalStatus(status: string): FleetApprovalStatus {
	if (status === 'approved') return 'approved';
	if (status === 'rejected' || status === 'cancelled' || status === 'expired') return 'rejected';
	return 'pending';
}

function requireTemplateKind(value: unknown): AutomationTemplateKind {
	const kind = asTrimmedString(value) as AutomationTemplateKind | null;
	const allowed: BuiltInTemplateKind[] = [
		'ssh_command',
		'file_transfer',
		'ssh_tunnel',
		'rdp_checklist',
		'operator_note'
	];
	if (!kind || !allowed.includes(kind)) {
		throw new ServiceValidationError(['kind must be a supported automation template kind']);
	}
	return kind;
}

function requireName(value: unknown): string {
	const name = asTrimmedString(value);
	if (!name) throw new ServiceValidationError(['name is required']);
	return name;
}

function requireTargetHostIds(value: unknown): string[] {
	if (!Array.isArray(value)) throw new ServiceValidationError(['targetHostIds must be an array']);
	const ids = [...new Set(value.map(asTrimmedString).filter((id): id is string => Boolean(id)))];
	if (ids.length === 0) {
		throw new ServiceValidationError(['targetHostIds must include at least one visible host']);
	}
	return ids;
}

function requireId(value: unknown, label: string): string {
	const id = asTrimmedString(value);
	if (!id) throw new ServiceValidationError([`${label} is required`]);
	return id;
}

function normalizeVariableNames(value: unknown): string[] {
	if (Array.isArray(value)) {
		return [...new Set(value.map(asTrimmedString).filter((item): item is string => Boolean(item)))];
	}
	if (typeof value === 'string') {
		return [
			...new Set(
				value
					.split(',')
					.map(asTrimmedString)
					.filter((item): item is string => Boolean(item))
			)
		];
	}
	return [];
}

function defaultTemplateBody(kind: AutomationTemplateKind, variables: string[]): string {
	const body = variables.map((variable) => `${variable}: {{${variable}}}`).join('\n');
	return body || `${kind.replaceAll('_', ' ')} template`;
}

function normalizeConcurrency(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return 2;
	return Math.min(10, Math.max(1, Math.floor(parsed)));
}

function regionFromHost(host: HostRecord): string {
	const regionTag = host.tags.find((tag) => tag.startsWith('region:'));
	if (regionTag) return regionTag.slice('region:'.length) || 'default';
	return host.folder?.split('/').find(Boolean) ?? 'default';
}

function minutesSince(value: Date | null | undefined): number {
	if (!value) return 0;
	return Math.max(0, Math.round((Date.now() - value.getTime()) / 60_000));
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}
