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
	resolveFleetBulkOperationContract
} from '$lib/termix/fleet-contracts';
import type {
	FleetAutomationTemplate,
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
	WorkspacePolicyCapability,
	WorkspacePolicyRole
} from '$lib/server/services/v6-resources';
import type { WorkspaceMemberRole } from '$lib/server/services/types';

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

export const getFleetOverview = query(loadFleetOverview);

export const getFleetRunbooks = query(loadFleetRunbooks);
export const getFleetTargets = query(async () => (await loadFleetOverview()).hosts);
export const getFleetExecutions = query(async () => (await loadFleetOverview()).jobs);

async function loadFleetOverview(): Promise<FleetOverview> {
	const user = requireRemoteUser();
	const [hosts, workspaces] = await Promise.all([
		hostService.list(user.id),
		workspaceService.list(user.id)
	]);
	const workspaceIds = workspaces.map((workspace) => workspace.id);
	const hostIds = hosts.map((host) => host.id);
	const [templates, jobs, facts, health] = await Promise.all([
		v6ResourcesService.listAutomationTemplates(user.id, workspaceIds),
		v6ResourcesService.listBackgroundJobs(user.id, workspaceIds),
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
		jobs: jobs.map(toFleetJob).sort((left, right) => right.startedAt.localeCompare(left.startedAt))
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
		const membership = await workspaceService.assertMember(user.id, workspaceId);
		await assertWorkspacePolicyAllowed({
			workspaceId,
			role: policyRoleForWorkspaceMember(membership.role),
			capability: 'automation_template'
		});
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

export const queueFleetBulkOperation = command<
	QueueFleetBulkOperationInput,
	FleetExecutionSubmitResult
>('unchecked', async (input) => {
	const { user, operation, operationId, template, templateId, targetHostIds, targetHosts } =
		await prepareExecution(input);

	await assertBulkOperationPoliciesAllowed(
		user.id,
		targetHosts,
		operation.jobKind === 'bulk_file_transfer' ? ['bulk_job', 'file_transfer'] : ['bulk_job'],
		targetHostIds.length,
		asTrimmedString(input.reason)
	);
	await recordBulkJobReason(user.id, targetHosts, asTrimmedString(input.reason));
	const workspaceId = singleWorkspaceId(targetHosts);
	const result = await v6ResourcesService.createBackgroundJob(user.id, {
		workspaceId,
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
		reason: asTrimmedString(input.reason) ?? 'Fleet operation'
	});
	refreshFleetQueries();
	return {
		status: 'queued',
		job: toFleetJob(result.job),
		message: 'Execution queued.'
	};
});

function refreshFleetQueries() {
	void getFleetOverview().refresh();
	void getFleetRunbooks().refresh();
	void getFleetTargets().refresh();
	void getFleetExecutions().refresh();
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

async function prepareExecution(input: QueueFleetBulkOperationInput): Promise<{
	user: { id: string; username: string };
	operation: NonNullable<ReturnType<typeof resolveFleetBulkOperationContract>>;
	operationId: string;
	template: { id: string; version: number; kind: AutomationTemplateKind };
	templateId: string;
	targetHostIds: string[];
	targetHosts: HostRecord[];
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
	const expectedOperationId = operationIdForTemplateKind(template.kind);
	if (!expectedOperationId) {
		throw new ServiceValidationError(['templateId must reference a runnable fleet action']);
	}
	if (operation.id !== expectedOperationId) {
		throw new ServiceValidationError(['operationId must match the selected action']);
	}
	const targetHosts = visibleHosts.filter((host) => targetHostIds.includes(host.id));
	return { user, operation, operationId, template, templateId, targetHostIds, targetHosts };
}

async function resolveExecutionTemplate(
	userId: string,
	workspaceIds: string[],
	templateId: string
): Promise<{ id: string; version: number; kind: AutomationTemplateKind }> {
	const builtInTemplate = builtInAutomationTemplates.find((template) => template.id === templateId);
	if (builtInTemplate) {
		return {
			id: builtInTemplate.id,
			version: 1,
			kind: builtInTemplate.kind
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
		kind: template.kind
	};
}

function operationIdForTemplateKind(kind: AutomationTemplateKind) {
	if (kind === 'ssh_command') return 'bulk-ssh-command';
	if (kind === 'file_transfer') return 'bulk-file-transfer';
	return null;
}

function targetWorkspaceIds(targetHosts: HostRecord[]): string[] {
	return [
		...new Set(
			targetHosts.map((host) => host.workspaceId).filter((id): id is string => Boolean(id))
		)
	];
}

function singleWorkspaceId(targetHosts: HostRecord[]): string | null {
	const workspaceIds = targetWorkspaceIds(targetHosts);
	return workspaceIds.length === 1 &&
		targetHosts.every((host) => host.workspaceId === workspaceIds[0])
		? workspaceIds[0]
		: null;
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

async function assertBulkOperationPoliciesAllowed(
	userId: string,
	targetHosts: HostRecord[],
	capabilities: WorkspacePolicyCapability[],
	targetCount: number,
	reason: string | null
) {
	const workspaceIds = targetWorkspaceIds(targetHosts);
	if (workspaceIds.length === 0) return;
	await Promise.all(
		workspaceIds.map(async (workspaceId) => {
			const membership = await workspaceService.assertMember(userId, workspaceId);
			const role = policyRoleForWorkspaceMember(membership.role);
			await Promise.all(
				capabilities.map((capability) =>
					assertWorkspacePolicyAllowed({ workspaceId, role, capability, targetCount, reason })
				)
			);
		})
	);
}

async function assertWorkspacePolicyAllowed(input: {
	workspaceId: string;
	role: WorkspacePolicyRole;
	capability: WorkspacePolicyCapability;
	targetCount?: number;
	reason?: string | null;
}) {
	const evaluation = await v6ResourcesService.evaluateWorkspacePolicy(input);
	if (!evaluation.allowed) {
		throw new ServiceValidationError([
			`workspace policy blocks ${input.capability}: ${evaluation.blockedReason ?? 'not allowed'}`
		]);
	}
}

function policyRoleForWorkspaceMember(role: WorkspaceMemberRole): WorkspacePolicyRole {
	return role === 'owner' ? 'owner' : 'member';
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
		reason: health.failureReason ?? 'The latest health signal needs attention.',
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
		risk: template.isDangerous ? 'high' : 'low',
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
