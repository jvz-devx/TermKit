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
	FleetApprovalStatus,
	FleetAutomationTemplate,
	FleetHealthStatus,
	FleetHost,
	FleetJob,
	FleetJobStatus,
	FleetOverview
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

export type DecideFleetApprovalInput = {
	approvalId?: unknown;
	status?: unknown;
	reason?: unknown;
};

export const getFleetOverview = query(async (): Promise<FleetOverview> => {
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
		hosts: hosts.map((host) =>
			toFleetHost(
				host,
				workspacesById.get(host.workspaceId ?? ''),
				factsByHost.get(host.id),
				healthByHost.get(host.id)
			)
		),
		templates: [
			...builtInAutomationTemplates.map(toBuiltInFleetTemplate),
			...templates.map(toFleetTemplate)
		].sort((left, right) => left.name.localeCompare(right.name)),
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
});

export const createFleetAutomationTemplate = command<
	CreateFleetAutomationTemplateInput,
	FleetAutomationTemplate
>('unchecked', async (input) => {
	const user = requireRemoteUser();
	const kind = requireTemplateKind(input.kind);
	const variableNames = normalizeVariableNames(input.variables);
	const workspaceId =
		input.visibility === 'workspace'
			? (asTrimmedString(input.workspaceId) ??
				(await workspaceService.list(user.id))[0]?.id ??
				null)
			: null;
	if (input.visibility === 'workspace' && !workspaceId) {
		throw new ServiceValidationError(['workspace visibility requires workspaceId']);
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
	void getFleetOverview().refresh();
	return toFleetTemplate(template);
});

export const queueFleetBulkOperation = command<QueueFleetBulkOperationInput, FleetJob>(
	'unchecked',
	async (input) => {
		const user = requireRemoteUser();
		const operationId = asTrimmedString(input.operationId) ?? 'bulk-ssh-command';
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
		const targetHosts = visibleHosts.filter((host) => targetHostIds.includes(host.id));
		await enforceBulkJobPolicies(user.id, targetHosts, {
			reason: asTrimmedString(input.reason),
			operationId
		});

		const result = await v6ResourcesService.createBackgroundJob(user.id, {
			workspaceId: targetHosts[0]?.workspaceId ?? null,
			templateId: asTrimmedString(input.templateId),
			templateVersion: 1,
			kind: operation.jobKind,
			title: operation.jobTitle,
			request: {
				operationId,
				templateId: asTrimmedString(input.templateId),
				reviewedHostIds: targetHostIds,
				secretPolicy: operation.secretPolicy
			},
			targetHostIds,
			concurrencyLimit: normalizeConcurrency(input.concurrencyLimit),
			reason: asTrimmedString(input.reason) ?? 'Reviewed from fleet operations'
		});
		void getFleetOverview().refresh();
		return toFleetJob(result.job);
	}
);

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
		void getFleetOverview().refresh();
	}
);

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
		tags: host.tags
	};
}

async function enforceBulkJobPolicies(
	userId: string,
	targetHosts: HostRecord[],
	input: { reason: string | null; operationId: string }
): Promise<void> {
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
			await v6ResourcesService.requestApproval(userId, {
				workspaceId,
				capability: 'bulk_job',
				reason: input.reason ?? `${input.operationId} requires approval`
			});
			throw new ServiceValidationError(['bulk job approval is required']);
		}
		if (!decision.allowed) {
			throw new ServiceValidationError([decision.blockedReason ?? 'bulk job is blocked by policy']);
		}
		if (input.reason) {
			await v6ResourcesService.recordOperationReason(userId, {
				workspaceId,
				capability: 'bulk_job',
				reason: input.reason
			});
		}
	}
	if (workspaceIds.length === 0 && input.reason) {
		await v6ResourcesService.recordOperationReason(userId, {
			workspaceId: null,
			capability: 'bulk_job',
			reason: input.reason
		});
	}
}

function toBuiltInFleetTemplate(
	template: (typeof builtInAutomationTemplates)[number]
): FleetAutomationTemplate {
	return {
		id: template.id,
		name: template.name,
		category: template.kind.replaceAll('_', ' '),
		description: template.description,
		risk: template.kind === 'file_transfer' || template.kind === 'ssh_tunnel' ? 'medium' : 'low',
		approvalRequired: template.kind === 'file_transfer' || template.kind === 'ssh_tunnel',
		estimatedDuration: 'preview',
		lastRun: 'built-in',
		parameters: template.variables.map((variable) => variable.key)
	};
}

function toFleetTemplate(template: AutomationTemplateRecord): FleetAutomationTemplate {
	return {
		id: template.id,
		name: template.name,
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
		reportUrl: `/fleet/reports/${job.id}`
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
