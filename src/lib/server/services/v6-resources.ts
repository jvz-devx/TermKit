import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { db, type TermixDb } from '$lib/server/db';
import {
	approvalRequests,
	automationTemplates,
	backgroundJobs,
	hostFacts,
	hostHealth,
	jobEvents,
	jobReports,
	jobTargets,
	operationReasons,
	workspacePolicies
} from '$lib/server/db/schema';
import { ServiceNotFoundError, ServiceValidationError } from './errors';

const secretKeyPattern = /(password|passwd|passphrase|secret|token|api[_-]?key|private[_-]?key)/i;

export const automationTemplateKinds = [
	'ssh_command',
	'file_transfer',
	'ssh_tunnel',
	'rdp_checklist',
	'operator_note'
] as const;
export type AutomationTemplateKind = (typeof automationTemplateKinds)[number];

export const automationTemplateVisibilities = ['private', 'workspace'] as const;
export type AutomationTemplateVisibility = (typeof automationTemplateVisibilities)[number];

export const automationVariableKinds = [
	'string',
	'number',
	'boolean',
	'enum',
	'secret_ref',
	'path'
] as const;
export type AutomationVariableKind = (typeof automationVariableKinds)[number];

export const backgroundJobKinds = [
	'template_run',
	'bulk_ssh_command',
	'bulk_file_transfer',
	'bulk_host_edit',
	'inventory_check'
] as const;
export type BackgroundJobKind = (typeof backgroundJobKinds)[number];

export const backgroundJobStatuses = [
	'pending',
	'queued',
	'running',
	'cancelling',
	'cancelled',
	'completed',
	'completed_with_errors',
	'failed'
] as const;
export type BackgroundJobStatus = (typeof backgroundJobStatuses)[number];

export const jobTargetStatuses = [
	'pending',
	'queued',
	'running',
	'succeeded',
	'failed',
	'skipped',
	'cancelling',
	'cancelled',
	'retrying'
] as const;
export type JobTargetStatus = (typeof jobTargetStatuses)[number];

export const jobEventSeverities = ['debug', 'info', 'warning', 'error'] as const;
export type JobEventSeverity = (typeof jobEventSeverities)[number];

export const jobReportFormats = ['json', 'csv'] as const;
export type JobReportFormat = (typeof jobReportFormats)[number];

export const workspacePolicyCapabilities = [
	'launch_session',
	'file_transfer',
	'ssh_tunnel',
	'terminal_recording',
	'rdp_clipboard',
	'rdp_audio',
	'automation_template',
	'bulk_job',
	'host_facts'
] as const;
export type WorkspacePolicyCapability = (typeof workspacePolicyCapabilities)[number];

export const workspacePolicyEffects = [
	'allow',
	'deny',
	'approval_required',
	'reason_required'
] as const;
export type WorkspacePolicyEffect = (typeof workspacePolicyEffects)[number];

export const approvalRequestStatuses = [
	'pending',
	'approved',
	'rejected',
	'cancelled',
	'expired'
] as const;
export type ApprovalRequestStatus = (typeof approvalRequestStatuses)[number];

export const hostFactSources = ['ssh', 'manual', 'import'] as const;
export type HostFactSource = (typeof hostFactSources)[number];

export const hostHealthStates = [
	'unknown',
	'healthy',
	'stale',
	'unreachable',
	'auth_failed',
	'degraded',
	'never_used'
] as const;
export type HostHealthState = (typeof hostHealthStates)[number];

export const workspacePolicyRoles = [
	'viewer',
	'member',
	'operator',
	'maintainer',
	'owner'
] as const;
export type WorkspacePolicyRole = (typeof workspacePolicyRoles)[number];

export interface AutomationVariable {
	name: string;
	kind: AutomationVariableKind;
	required?: boolean;
	defaultValue?: unknown;
	options?: string[];
}

export interface AutomationTemplateRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	name: string;
	kind: AutomationTemplateKind;
	visibility: AutomationTemplateVisibility;
	version: number;
	description: string | null;
	definition: Record<string, unknown>;
	variables: AutomationVariable[];
	isDangerous: boolean;
	requiresApproval: boolean;
	lastUsedAt: Date | null;
	usageCount: number;
	updatedBy: string | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface BackgroundJobRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	templateId: string | null;
	templateVersion: number | null;
	kind: BackgroundJobKind;
	status: BackgroundJobStatus;
	title: string;
	request: Record<string, unknown>;
	targetCount: number;
	completedCount: number;
	failedCount: number;
	skippedCount: number;
	concurrencyLimit: number;
	reason: string | null;
	cancellationRequestedAt: Date | null;
	startedAt: Date | null;
	finishedAt: Date | null;
	retentionExpiresAt: Date | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface JobTargetRecord {
	id: string;
	jobId: string;
	hostId: string | null;
	status: JobTargetStatus;
	attempt: number;
	maxAttempts: number;
	startedAt: Date | null;
	finishedAt: Date | null;
	errorCode: string | null;
	errorMessage: string | null;
	output: Record<string, unknown>;
	report: Record<string, unknown>;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface JobEventRecord {
	id: string;
	jobId: string;
	targetId: string | null;
	severity: JobEventSeverity;
	code: string;
	message: string;
	details: Record<string, unknown>;
	createdAt: Date;
}

export interface JobReportRecord {
	id: string;
	jobId: string;
	format: JobReportFormat;
	storageKey: string;
	summary: Record<string, unknown>;
	generatedBy: string | null;
	generatedAt: Date;
	expiresAt: Date | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
}

export interface WorkspacePolicyRecord {
	id: string;
	workspaceId: string;
	capability: WorkspacePolicyCapability;
	effect: WorkspacePolicyEffect;
	minimumRole: WorkspacePolicyRole;
	maxTargets: number | null;
	requireReason: boolean;
	settings: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface ApprovalRequestRecord {
	id: string;
	workspaceId: string | null;
	jobId: string | null;
	templateId: string | null;
	capability: WorkspacePolicyCapability;
	status: ApprovalRequestStatus;
	requestedBy: string;
	decidedBy: string | null;
	reason: string | null;
	decisionReason: string | null;
	requestedAt: Date;
	decidedAt: Date | null;
	expiresAt: Date | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface OperationReasonRecord {
	id: string;
	workspaceId: string | null;
	userId: string;
	hostId: string | null;
	jobId: string | null;
	templateId: string | null;
	capability: WorkspacePolicyCapability;
	reason: string;
	metadata: Record<string, unknown>;
	createdAt: Date;
}

export interface HostFactsRecord {
	id: string;
	hostId: string;
	workspaceId: string | null;
	collectedBy: string | null;
	source: HostFactSource;
	osName: string | null;
	osVersion: string | null;
	kernel: string | null;
	uptimeSeconds: number | null;
	cpu: Record<string, unknown>;
	memory: Record<string, unknown>;
	disk: Record<string, unknown>;
	serviceHints: Record<string, unknown>[];
	facts: Record<string, unknown>;
	collectedAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface HostHealthRecord {
	id: string;
	hostId: string;
	workspaceId: string | null;
	state: HostHealthState;
	lastSuccessfulConnectionAt: Date | null;
	lastFailedConnectionAt: Date | null;
	consecutiveFailures: number;
	failureReason: string | null;
	checkedAt: Date;
	nextCheckAt: Date | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export type AutomationTemplateInput = Partial<
	Pick<
		AutomationTemplateRecord,
		| 'workspaceId'
		| 'name'
		| 'kind'
		| 'visibility'
		| 'description'
		| 'definition'
		| 'variables'
		| 'isDangerous'
		| 'requiresApproval'
		| 'metadata'
	>
>;

export type BackgroundJobInput = Partial<
	Pick<
		BackgroundJobRecord,
		| 'workspaceId'
		| 'templateId'
		| 'templateVersion'
		| 'kind'
		| 'title'
		| 'request'
		| 'concurrencyLimit'
		| 'reason'
		| 'retentionExpiresAt'
		| 'metadata'
	>
> & {
	targetHostIds?: unknown;
};

export type JobTargetPatch = Partial<
	Pick<
		JobTargetRecord,
		| 'status'
		| 'attempt'
		| 'startedAt'
		| 'finishedAt'
		| 'errorCode'
		| 'errorMessage'
		| 'output'
		| 'report'
		| 'metadata'
		| 'updatedAt'
	>
>;

export interface WorkspacePolicyInput {
	workspaceId?: unknown;
	capability?: unknown;
	effect?: unknown;
	minimumRole?: unknown;
	maxTargets?: unknown;
	requireReason?: unknown;
	settings?: unknown;
}

export interface PolicyEvaluationInput {
	workspaceId: string;
	capability: WorkspacePolicyCapability;
	role: WorkspacePolicyRole;
	targetCount?: number;
	reason?: string | null;
}

export interface PolicyEvaluation {
	allowed: boolean;
	approvalRequired: boolean;
	reasonRequired: boolean;
	policy: WorkspacePolicyRecord | null;
	blockedReason: string | null;
}

export type ApprovalRequestInput = Partial<
	Pick<
		ApprovalRequestRecord,
		'workspaceId' | 'jobId' | 'templateId' | 'capability' | 'reason' | 'expiresAt' | 'metadata'
	>
>;

export type OperationReasonInput = Partial<
	Pick<
		OperationReasonRecord,
		'workspaceId' | 'hostId' | 'jobId' | 'templateId' | 'capability' | 'reason' | 'metadata'
	>
>;

export type HostFactsInput = Partial<
	Pick<
		HostFactsRecord,
		| 'hostId'
		| 'workspaceId'
		| 'collectedBy'
		| 'source'
		| 'osName'
		| 'osVersion'
		| 'kernel'
		| 'uptimeSeconds'
		| 'cpu'
		| 'memory'
		| 'disk'
		| 'serviceHints'
		| 'facts'
		| 'collectedAt'
	>
>;

export type HostHealthInput = Partial<
	Pick<
		HostHealthRecord,
		| 'hostId'
		| 'workspaceId'
		| 'state'
		| 'lastSuccessfulConnectionAt'
		| 'lastFailedConnectionAt'
		| 'consecutiveFailures'
		| 'failureReason'
		| 'checkedAt'
		| 'nextCheckAt'
		| 'metadata'
	>
>;

type AutomationTemplateRow = typeof automationTemplates.$inferSelect;
type BackgroundJobRow = typeof backgroundJobs.$inferSelect;
type JobTargetRow = typeof jobTargets.$inferSelect;
type JobEventRow = typeof jobEvents.$inferSelect;
type JobReportRow = typeof jobReports.$inferSelect;
type WorkspacePolicyRow = typeof workspacePolicies.$inferSelect;
type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
type OperationReasonRow = typeof operationReasons.$inferSelect;
type HostFactsRow = typeof hostFacts.$inferSelect;
type HostHealthRow = typeof hostHealth.$inferSelect;

export interface V6ResourcesRepository {
	listAutomationTemplates(
		userId: string,
		workspaceIds?: string[]
	): Promise<AutomationTemplateRecord[]>;
	getAutomationTemplate(id: string): Promise<AutomationTemplateRecord | null>;
	createAutomationTemplate(template: AutomationTemplateRecord): Promise<AutomationTemplateRecord>;
	listBackgroundJobs(userId: string, workspaceIds?: string[]): Promise<BackgroundJobRecord[]>;
	createBackgroundJobWithTargets(
		job: BackgroundJobRecord,
		targets: JobTargetRecord[]
	): Promise<{ job: BackgroundJobRecord; targets: JobTargetRecord[] }>;
	getBackgroundJob(id: string): Promise<BackgroundJobRecord | null>;
	updateBackgroundJob(
		id: string,
		patch: Partial<BackgroundJobRecord>
	): Promise<BackgroundJobRecord | null>;
	listJobTargets(jobId: string): Promise<JobTargetRecord[]>;
	updateJobTarget(id: string, patch: JobTargetPatch): Promise<JobTargetRecord | null>;
	recordJobEvent(event: JobEventRecord): Promise<JobEventRecord>;
	createJobReport(report: JobReportRecord): Promise<JobReportRecord>;
	getWorkspacePolicy(
		workspaceId: string,
		capability: WorkspacePolicyCapability
	): Promise<WorkspacePolicyRecord | null>;
	upsertWorkspacePolicy(policy: WorkspacePolicyRecord): Promise<WorkspacePolicyRecord>;
	listApprovalRequests(userId: string, workspaceIds?: string[]): Promise<ApprovalRequestRecord[]>;
	createApprovalRequest(request: ApprovalRequestRecord): Promise<ApprovalRequestRecord>;
	updateApprovalRequest(
		id: string,
		patch: Partial<ApprovalRequestRecord>
	): Promise<ApprovalRequestRecord | null>;
	recordOperationReason(reason: OperationReasonRecord): Promise<OperationReasonRecord>;
	listHostFacts(hostIds: string[]): Promise<HostFactsRecord[]>;
	upsertHostFacts(facts: HostFactsRecord): Promise<HostFactsRecord>;
	getHostFacts(hostId: string): Promise<HostFactsRecord | null>;
	listHostHealth(hostIds: string[]): Promise<HostHealthRecord[]>;
	upsertHostHealth(health: HostHealthRecord): Promise<HostHealthRecord>;
	getHostHealth(hostId: string): Promise<HostHealthRecord | null>;
}

export class DrizzleV6ResourcesRepository implements V6ResourcesRepository {
	constructor(private readonly database: TermixDb = db) {}

	async listAutomationTemplates(
		userId: string,
		workspaceIds: string[] = []
	): Promise<AutomationTemplateRecord[]> {
		const filters =
			workspaceIds.length > 0
				? or(
						eq(automationTemplates.userId, userId),
						inArray(automationTemplates.workspaceId, workspaceIds)
					)
				: eq(automationTemplates.userId, userId);
		const rows = await this.database.select().from(automationTemplates).where(filters);
		return rows.map(toAutomationTemplateRecord);
	}

	async getAutomationTemplate(id: string): Promise<AutomationTemplateRecord | null> {
		const [row] = await this.database
			.select()
			.from(automationTemplates)
			.where(eq(automationTemplates.id, id))
			.limit(1);
		return row ? toAutomationTemplateRecord(row) : null;
	}

	async createAutomationTemplate(
		template: AutomationTemplateRecord
	): Promise<AutomationTemplateRecord> {
		const [row] = await this.database.insert(automationTemplates).values(template).returning();
		if (!row) throw new Error('Could not create automation template');
		return toAutomationTemplateRecord(row);
	}

	async listBackgroundJobs(
		userId: string,
		workspaceIds: string[] = []
	): Promise<BackgroundJobRecord[]> {
		const filters =
			workspaceIds.length > 0
				? or(eq(backgroundJobs.userId, userId), inArray(backgroundJobs.workspaceId, workspaceIds))
				: eq(backgroundJobs.userId, userId);
		const rows = await this.database.select().from(backgroundJobs).where(filters);
		return rows.map(toBackgroundJobRecord);
	}

	async createBackgroundJobWithTargets(
		job: BackgroundJobRecord,
		targets: JobTargetRecord[]
	): Promise<{ job: BackgroundJobRecord; targets: JobTargetRecord[] }> {
		return this.database.transaction(async (tx) => {
			const [jobRow] = await tx.insert(backgroundJobs).values(job).returning();
			if (!jobRow) throw new Error('Could not create background job');
			const targetRows =
				targets.length > 0 ? await tx.insert(jobTargets).values(targets).returning() : [];
			return {
				job: toBackgroundJobRecord(jobRow),
				targets: targetRows.map(toJobTargetRecord)
			};
		});
	}

	async getBackgroundJob(id: string): Promise<BackgroundJobRecord | null> {
		const [row] = await this.database
			.select()
			.from(backgroundJobs)
			.where(eq(backgroundJobs.id, id))
			.limit(1);
		return row ? toBackgroundJobRecord(row) : null;
	}

	async updateBackgroundJob(
		id: string,
		patch: Partial<BackgroundJobRecord>
	): Promise<BackgroundJobRecord | null> {
		const [row] = await this.database
			.update(backgroundJobs)
			.set(backgroundJobPatchToDb(patch))
			.where(eq(backgroundJobs.id, id))
			.returning();
		return row ? toBackgroundJobRecord(row) : null;
	}

	async listJobTargets(jobId: string): Promise<JobTargetRecord[]> {
		const rows = await this.database.select().from(jobTargets).where(eq(jobTargets.jobId, jobId));
		return rows.map(toJobTargetRecord);
	}

	async updateJobTarget(id: string, patch: JobTargetPatch): Promise<JobTargetRecord | null> {
		const [row] = await this.database
			.update(jobTargets)
			.set(jobTargetPatchToDb(patch))
			.where(eq(jobTargets.id, id))
			.returning();
		return row ? toJobTargetRecord(row) : null;
	}

	async recordJobEvent(event: JobEventRecord): Promise<JobEventRecord> {
		const [row] = await this.database.insert(jobEvents).values(event).returning();
		if (!row) throw new Error('Could not record job event');
		return toJobEventRecord(row);
	}

	async createJobReport(report: JobReportRecord): Promise<JobReportRecord> {
		const [row] = await this.database.insert(jobReports).values(report).returning();
		if (!row) throw new Error('Could not create job report');
		return toJobReportRecord(row);
	}

	async getWorkspacePolicy(
		workspaceId: string,
		capability: WorkspacePolicyCapability
	): Promise<WorkspacePolicyRecord | null> {
		const [row] = await this.database
			.select()
			.from(workspacePolicies)
			.where(
				and(
					eq(workspacePolicies.workspaceId, workspaceId),
					eq(workspacePolicies.capability, capability)
				)
			)
			.limit(1);
		return row ? toWorkspacePolicyRecord(row) : null;
	}

	async upsertWorkspacePolicy(policy: WorkspacePolicyRecord): Promise<WorkspacePolicyRecord> {
		const [row] = await this.database
			.insert(workspacePolicies)
			.values(policy)
			.onConflictDoUpdate({
				target: [workspacePolicies.workspaceId, workspacePolicies.capability],
				set: workspacePolicyPatchToDb(policy)
			})
			.returning();
		if (!row) throw new Error('Could not upsert workspace policy');
		return toWorkspacePolicyRecord(row);
	}

	async listApprovalRequests(
		userId: string,
		workspaceIds: string[] = []
	): Promise<ApprovalRequestRecord[]> {
		const filters =
			workspaceIds.length > 0
				? or(
						eq(approvalRequests.requestedBy, userId),
						inArray(approvalRequests.workspaceId, workspaceIds)
					)
				: eq(approvalRequests.requestedBy, userId);
		const rows = await this.database.select().from(approvalRequests).where(filters);
		return rows.map(toApprovalRequestRecord);
	}

	async createApprovalRequest(request: ApprovalRequestRecord): Promise<ApprovalRequestRecord> {
		const [row] = await this.database.insert(approvalRequests).values(request).returning();
		if (!row) throw new Error('Could not create approval request');
		return toApprovalRequestRecord(row);
	}

	async updateApprovalRequest(
		id: string,
		patch: Partial<ApprovalRequestRecord>
	): Promise<ApprovalRequestRecord | null> {
		const [row] = await this.database
			.update(approvalRequests)
			.set(approvalRequestPatchToDb(patch))
			.where(eq(approvalRequests.id, id))
			.returning();
		return row ? toApprovalRequestRecord(row) : null;
	}

	async recordOperationReason(reason: OperationReasonRecord): Promise<OperationReasonRecord> {
		const [row] = await this.database.insert(operationReasons).values(reason).returning();
		if (!row) throw new Error('Could not record operation reason');
		return toOperationReasonRecord(row);
	}

	async listHostFacts(hostIds: string[]): Promise<HostFactsRecord[]> {
		if (hostIds.length === 0) return [];
		const rows = await this.database
			.select()
			.from(hostFacts)
			.where(inArray(hostFacts.hostId, hostIds));
		return rows.map(toHostFactsRecord);
	}

	async upsertHostFacts(facts: HostFactsRecord): Promise<HostFactsRecord> {
		const [row] = await this.database
			.insert(hostFacts)
			.values(facts)
			.onConflictDoUpdate({
				target: hostFacts.hostId,
				set: hostFactsPatchToDb(facts)
			})
			.returning();
		if (!row) throw new Error('Could not upsert host facts');
		return toHostFactsRecord(row);
	}

	async getHostFacts(hostId: string): Promise<HostFactsRecord | null> {
		const [row] = await this.database
			.select()
			.from(hostFacts)
			.where(eq(hostFacts.hostId, hostId))
			.limit(1);
		return row ? toHostFactsRecord(row) : null;
	}

	async listHostHealth(hostIds: string[]): Promise<HostHealthRecord[]> {
		if (hostIds.length === 0) return [];
		const rows = await this.database
			.select()
			.from(hostHealth)
			.where(inArray(hostHealth.hostId, hostIds));
		return rows.map(toHostHealthRecord);
	}

	async upsertHostHealth(health: HostHealthRecord): Promise<HostHealthRecord> {
		const [row] = await this.database
			.insert(hostHealth)
			.values(health)
			.onConflictDoUpdate({
				target: hostHealth.hostId,
				set: hostHealthPatchToDb(health)
			})
			.returning();
		if (!row) throw new Error('Could not upsert host health');
		return toHostHealthRecord(row);
	}

	async getHostHealth(hostId: string): Promise<HostHealthRecord | null> {
		const [row] = await this.database
			.select()
			.from(hostHealth)
			.where(eq(hostHealth.hostId, hostId))
			.limit(1);
		return row ? toHostHealthRecord(row) : null;
	}
}

export class InMemoryV6ResourcesRepository implements V6ResourcesRepository {
	readonly automationTemplates = new Map<string, AutomationTemplateRecord>();
	readonly backgroundJobs = new Map<string, BackgroundJobRecord>();
	readonly jobTargets = new Map<string, JobTargetRecord>();
	readonly jobEvents = new Map<string, JobEventRecord>();
	readonly jobReports = new Map<string, JobReportRecord>();
	readonly workspacePolicies = new Map<string, WorkspacePolicyRecord>();
	readonly approvalRequests = new Map<string, ApprovalRequestRecord>();
	readonly operationReasons = new Map<string, OperationReasonRecord>();
	readonly hostFacts = new Map<string, HostFactsRecord>();
	readonly hostHealth = new Map<string, HostHealthRecord>();

	async listAutomationTemplates(
		userId: string,
		workspaceIds: string[] = []
	): Promise<AutomationTemplateRecord[]> {
		return [...this.automationTemplates.values()].filter(
			(template) =>
				template.userId === userId ||
				(template.workspaceId !== null && workspaceIds.includes(template.workspaceId))
		);
	}

	async getAutomationTemplate(id: string): Promise<AutomationTemplateRecord | null> {
		return this.automationTemplates.get(id) ?? null;
	}

	async createAutomationTemplate(
		template: AutomationTemplateRecord
	): Promise<AutomationTemplateRecord> {
		this.automationTemplates.set(template.id, template);
		return template;
	}

	async listBackgroundJobs(
		userId: string,
		workspaceIds: string[] = []
	): Promise<BackgroundJobRecord[]> {
		return [...this.backgroundJobs.values()].filter(
			(job) =>
				job.userId === userId ||
				(job.workspaceId !== null && workspaceIds.includes(job.workspaceId))
		);
	}

	async createBackgroundJobWithTargets(
		job: BackgroundJobRecord,
		targets: JobTargetRecord[]
	): Promise<{ job: BackgroundJobRecord; targets: JobTargetRecord[] }> {
		this.backgroundJobs.set(job.id, job);
		for (const target of targets) this.jobTargets.set(target.id, target);
		return { job, targets };
	}

	async getBackgroundJob(id: string): Promise<BackgroundJobRecord | null> {
		return this.backgroundJobs.get(id) ?? null;
	}

	async updateBackgroundJob(
		id: string,
		patch: Partial<BackgroundJobRecord>
	): Promise<BackgroundJobRecord | null> {
		const job = this.backgroundJobs.get(id);
		if (!job) return null;
		const updated = { ...job, ...patch, id };
		this.backgroundJobs.set(id, updated);
		return updated;
	}

	async listJobTargets(jobId: string): Promise<JobTargetRecord[]> {
		return [...this.jobTargets.values()].filter((target) => target.jobId === jobId);
	}

	async updateJobTarget(id: string, patch: JobTargetPatch): Promise<JobTargetRecord | null> {
		const target = this.jobTargets.get(id);
		if (!target) return null;
		const updated = { ...target, ...patch, id };
		this.jobTargets.set(id, updated);
		return updated;
	}

	async recordJobEvent(event: JobEventRecord): Promise<JobEventRecord> {
		this.jobEvents.set(event.id, event);
		return event;
	}

	async createJobReport(report: JobReportRecord): Promise<JobReportRecord> {
		this.jobReports.set(report.id, report);
		return report;
	}

	async getWorkspacePolicy(
		workspaceId: string,
		capability: WorkspacePolicyCapability
	): Promise<WorkspacePolicyRecord | null> {
		return this.workspacePolicies.get(workspacePolicyKey(workspaceId, capability)) ?? null;
	}

	async upsertWorkspacePolicy(policy: WorkspacePolicyRecord): Promise<WorkspacePolicyRecord> {
		this.workspacePolicies.set(workspacePolicyKey(policy.workspaceId, policy.capability), policy);
		return policy;
	}

	async listApprovalRequests(
		userId: string,
		workspaceIds: string[] = []
	): Promise<ApprovalRequestRecord[]> {
		return [...this.approvalRequests.values()].filter(
			(request) =>
				request.requestedBy === userId ||
				(request.workspaceId !== null && workspaceIds.includes(request.workspaceId))
		);
	}

	async createApprovalRequest(request: ApprovalRequestRecord): Promise<ApprovalRequestRecord> {
		this.approvalRequests.set(request.id, request);
		return request;
	}

	async updateApprovalRequest(
		id: string,
		patch: Partial<ApprovalRequestRecord>
	): Promise<ApprovalRequestRecord | null> {
		const request = this.approvalRequests.get(id);
		if (!request) return null;
		const updated = { ...request, ...patch, id };
		this.approvalRequests.set(id, updated);
		return updated;
	}

	async recordOperationReason(reason: OperationReasonRecord): Promise<OperationReasonRecord> {
		this.operationReasons.set(reason.id, reason);
		return reason;
	}

	async listHostFacts(hostIds: string[]): Promise<HostFactsRecord[]> {
		const ids = new Set(hostIds);
		return [...this.hostFacts.values()].filter((facts) => ids.has(facts.hostId));
	}

	async upsertHostFacts(facts: HostFactsRecord): Promise<HostFactsRecord> {
		this.hostFacts.set(facts.hostId, facts);
		return facts;
	}

	async getHostFacts(hostId: string): Promise<HostFactsRecord | null> {
		return this.hostFacts.get(hostId) ?? null;
	}

	async listHostHealth(hostIds: string[]): Promise<HostHealthRecord[]> {
		const ids = new Set(hostIds);
		return [...this.hostHealth.values()].filter((health) => ids.has(health.hostId));
	}

	async upsertHostHealth(health: HostHealthRecord): Promise<HostHealthRecord> {
		this.hostHealth.set(health.hostId, health);
		return health;
	}

	async getHostHealth(hostId: string): Promise<HostHealthRecord | null> {
		return this.hostHealth.get(hostId) ?? null;
	}
}

export class V6ResourcesService {
	constructor(
		private readonly repository: V6ResourcesRepository = new DrizzleV6ResourcesRepository()
	) {}

	listAutomationTemplates(
		userId: string,
		workspaceIds: string[] = []
	): Promise<AutomationTemplateRecord[]> {
		return this.repository.listAutomationTemplates(userId, workspaceIds);
	}

	listBackgroundJobs(userId: string, workspaceIds: string[] = []): Promise<BackgroundJobRecord[]> {
		return this.repository.listBackgroundJobs(userId, workspaceIds);
	}

	listApprovalRequests(
		userId: string,
		workspaceIds: string[] = []
	): Promise<ApprovalRequestRecord[]> {
		return this.repository.listApprovalRequests(userId, workspaceIds);
	}

	listHostFacts(hostIds: string[]): Promise<HostFactsRecord[]> {
		return this.repository.listHostFacts([...new Set(hostIds)]);
	}

	listHostHealth(hostIds: string[]): Promise<HostHealthRecord[]> {
		return this.repository.listHostHealth([...new Set(hostIds)]);
	}

	async createAutomationTemplate(
		userId: string,
		input: AutomationTemplateInput
	): Promise<AutomationTemplateRecord> {
		const now = new Date();
		const validated = validateAutomationTemplateInput(input);
		return this.repository.createAutomationTemplate({
			id: randomUUID(),
			userId,
			version: 1,
			lastUsedAt: null,
			usageCount: 0,
			updatedBy: userId,
			createdAt: now,
			updatedAt: now,
			...validated
		});
	}

	async createBackgroundJob(
		userId: string,
		input: BackgroundJobInput
	): Promise<{ job: BackgroundJobRecord; targets: JobTargetRecord[] }> {
		const now = new Date();
		const validated = validateBackgroundJobInput(input);
		const jobId = randomUUID();
		const targets = validated.targetHostIds.map((hostId) => ({
			id: randomUUID(),
			jobId,
			hostId,
			status: 'pending' as const,
			attempt: 0,
			maxAttempts: 1,
			startedAt: null,
			finishedAt: null,
			errorCode: null,
			errorMessage: null,
			output: {},
			report: {},
			metadata: {},
			createdAt: now,
			updatedAt: now
		}));

		return this.repository.createBackgroundJobWithTargets(
			{
				id: jobId,
				userId,
				workspaceId: validated.workspaceId,
				templateId: validated.templateId,
				templateVersion: validated.templateVersion,
				kind: validated.kind,
				status: 'pending',
				title: validated.title,
				request: validated.request,
				targetCount: targets.length,
				completedCount: 0,
				failedCount: 0,
				skippedCount: 0,
				concurrencyLimit: validated.concurrencyLimit,
				reason: validated.reason,
				cancellationRequestedAt: null,
				startedAt: null,
				finishedAt: null,
				retentionExpiresAt: validated.retentionExpiresAt,
				metadata: validated.metadata,
				createdAt: now,
				updatedAt: now
			},
			targets
		);
	}

	async updateJobTarget(id: string, patch: JobTargetPatch): Promise<JobTargetRecord> {
		const normalized = validateJobTargetPatch(patch);
		const updated = await this.repository.updateJobTarget(id, normalized);
		if (!updated) throw new ServiceNotFoundError('Job target not found');
		return updated;
	}

	async recordJobEvent(input: {
		jobId?: unknown;
		targetId?: unknown;
		severity?: unknown;
		code?: unknown;
		message?: unknown;
		details?: unknown;
	}): Promise<JobEventRecord> {
		const now = new Date();
		const event = validateJobEventInput(input, now);
		return this.repository.recordJobEvent(event);
	}

	async createJobReport(input: {
		jobId?: unknown;
		format?: unknown;
		storageKey?: unknown;
		summary?: unknown;
		generatedBy?: unknown;
		generatedAt?: unknown;
		expiresAt?: unknown;
		metadata?: unknown;
	}): Promise<JobReportRecord> {
		const report = validateJobReportInput(input);
		return this.repository.createJobReport(report);
	}

	async saveWorkspacePolicy(input: WorkspacePolicyInput): Promise<WorkspacePolicyRecord> {
		const now = new Date();
		const policy = validateWorkspacePolicyInput(input, now);
		return this.repository.upsertWorkspacePolicy(policy);
	}

	async evaluateWorkspacePolicy(input: PolicyEvaluationInput): Promise<PolicyEvaluation> {
		const policy = await this.repository.getWorkspacePolicy(input.workspaceId, input.capability);
		if (!policy) {
			return {
				allowed: true,
				approvalRequired: false,
				reasonRequired: false,
				policy,
				blockedReason: null
			};
		}

		if (!hasRequiredRole(input.role, policy.minimumRole)) {
			return {
				allowed: false,
				approvalRequired: false,
				reasonRequired: false,
				policy,
				blockedReason: `requires ${policy.minimumRole} role`
			};
		}
		if (policy.maxTargets !== null && (input.targetCount ?? 0) > policy.maxTargets) {
			return {
				allowed: false,
				approvalRequired: false,
				reasonRequired: false,
				policy,
				blockedReason: `target count exceeds ${policy.maxTargets}`
			};
		}
		if (policy.effect === 'deny') {
			return {
				allowed: false,
				approvalRequired: false,
				reasonRequired: false,
				policy,
				blockedReason: `${policy.capability} is denied`
			};
		}
		if (policy.effect === 'approval_required') {
			return {
				allowed: false,
				approvalRequired: true,
				reasonRequired: policy.requireReason,
				policy,
				blockedReason: 'approval is required'
			};
		}
		const reasonRequired = policy.requireReason || policy.effect === 'reason_required';
		if (reasonRequired && !asTrimmedString(input.reason)) {
			return {
				allowed: false,
				approvalRequired: false,
				reasonRequired: true,
				policy,
				blockedReason: 'reason is required'
			};
		}
		return { allowed: true, approvalRequired: false, reasonRequired, policy, blockedReason: null };
	}

	async requestApproval(
		userId: string,
		input: ApprovalRequestInput
	): Promise<ApprovalRequestRecord> {
		const now = new Date();
		const request = validateApprovalRequestInput(userId, input, now);
		return this.repository.createApprovalRequest(request);
	}

	async decideApproval(
		id: string,
		deciderUserId: string,
		status: ApprovalRequestStatus,
		decisionReason?: string | null
	): Promise<ApprovalRequestRecord> {
		if (status !== 'approved' && status !== 'rejected' && status !== 'cancelled') {
			throw new ServiceValidationError([
				'approval decision status must be approved, rejected, or cancelled'
			]);
		}
		const updated = await this.repository.updateApprovalRequest(id, {
			status,
			decidedBy: deciderUserId,
			decisionReason: asTrimmedString(decisionReason),
			decidedAt: new Date(),
			updatedAt: new Date()
		});
		if (!updated) throw new ServiceNotFoundError('Approval request not found');
		return updated;
	}

	async recordOperationReason(
		userId: string,
		input: OperationReasonInput
	): Promise<OperationReasonRecord> {
		const reason = validateOperationReasonInput(userId, input);
		return this.repository.recordOperationReason(reason);
	}

	async upsertHostFacts(input: HostFactsInput): Promise<HostFactsRecord> {
		const facts = validateHostFactsInput(input);
		return this.repository.upsertHostFacts(facts);
	}

	async upsertHostHealth(input: HostHealthInput): Promise<HostHealthRecord> {
		const health = validateHostHealthInput(input);
		return this.repository.upsertHostHealth(health);
	}
}

function validateAutomationTemplateInput(
	input: AutomationTemplateInput
): Omit<
	AutomationTemplateRecord,
	| 'id'
	| 'userId'
	| 'version'
	| 'lastUsedAt'
	| 'usageCount'
	| 'updatedBy'
	| 'createdAt'
	| 'updatedAt'
> {
	const issues: string[] = [];
	const name = asTrimmedString(input.name);
	const kind = input.kind;
	const visibility = input.visibility ?? 'private';
	const workspaceId = asNullableString(input.workspaceId);
	const variables = validateAutomationVariables(input.variables, issues);

	if (!name) issues.push('name is required');
	if (!automationTemplateKinds.includes(kind as AutomationTemplateKind)) {
		issues.push('kind must be a supported automation template kind');
	}
	if (!automationTemplateVisibilities.includes(visibility as AutomationTemplateVisibility)) {
		issues.push('visibility must be private or workspace');
	}
	if (visibility === 'workspace' && !workspaceId) {
		issues.push('workspace visibility requires workspaceId');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		workspaceId,
		name: name!,
		kind: kind as AutomationTemplateKind,
		visibility: visibility as AutomationTemplateVisibility,
		description: asNullableString(input.description),
		definition: asRecord(input.definition),
		variables,
		isDangerous: input.isDangerous === true,
		requiresApproval: input.requiresApproval === true || input.isDangerous === true,
		metadata: asRecord(input.metadata)
	};
}

function validateAutomationVariables(value: unknown, issues: string[]): AutomationVariable[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		issues.push('variables must be an array');
		return [];
	}

	const names = new Set<string>();
	const variables: AutomationVariable[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			issues.push('variables must contain objects');
			continue;
		}
		const name = asTrimmedString(item.name);
		const kind = item.kind;
		if (!name) {
			issues.push('variable name is required');
			continue;
		}
		if (names.has(name)) issues.push(`variable ${name} is duplicated`);
		names.add(name);
		if (!automationVariableKinds.includes(kind as AutomationVariableKind)) {
			issues.push(`variable ${name} kind is invalid`);
			continue;
		}
		variables.push({
			name,
			kind: kind as AutomationVariableKind,
			required: item.required === true,
			defaultValue: item.defaultValue,
			options: Array.isArray(item.options)
				? item.options.map(asTrimmedString).filter((option): option is string => Boolean(option))
				: undefined
		});
	}
	return variables;
}

function validateBackgroundJobInput(input: BackgroundJobInput): {
	workspaceId: string | null;
	templateId: string | null;
	templateVersion: number | null;
	kind: BackgroundJobKind;
	title: string;
	request: Record<string, unknown>;
	targetHostIds: string[];
	concurrencyLimit: number;
	reason: string | null;
	retentionExpiresAt: Date | null;
	metadata: Record<string, unknown>;
} {
	const issues: string[] = [];
	const kind = input.kind;
	const title = asTrimmedString(input.title);
	const targetHostIds = normalizeStringArray(input.targetHostIds);
	const concurrencyLimit = asInteger(input.concurrencyLimit ?? 1);
	const templateVersion =
		input.templateVersion === undefined || input.templateVersion === null
			? null
			: asInteger(input.templateVersion);

	if (!backgroundJobKinds.includes(kind as BackgroundJobKind)) {
		issues.push('kind must be a supported background job kind');
	}
	if (!title) issues.push('title is required');
	if (targetHostIds.length === 0)
		issues.push('targetHostIds must include at least one visible host');
	if (concurrencyLimit === null || concurrencyLimit < 1 || concurrencyLimit > 64) {
		issues.push('concurrencyLimit must be an integer between 1 and 64');
	}
	if (templateVersion !== null && (templateVersion < 1 || !Number.isInteger(templateVersion))) {
		issues.push('templateVersion must be a positive integer');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		workspaceId: asNullableString(input.workspaceId),
		templateId: asNullableString(input.templateId),
		templateVersion,
		kind: kind as BackgroundJobKind,
		title: title!,
		request: sanitizeRecordForPersistence(asRecord(input.request)),
		targetHostIds,
		concurrencyLimit: concurrencyLimit!,
		reason: asNullableString(input.reason),
		retentionExpiresAt: asDateOrNull(input.retentionExpiresAt),
		metadata: sanitizeRecordForPersistence(asRecord(input.metadata))
	};
}

function validateJobTargetPatch(patch: JobTargetPatch): JobTargetPatch {
	const issues: string[] = [];
	if (patch.status !== undefined && !jobTargetStatuses.includes(patch.status)) {
		issues.push('status must be a supported job target status');
	}
	if (patch.attempt !== undefined && (!Number.isInteger(patch.attempt) || patch.attempt < 0)) {
		issues.push('attempt must be a non-negative integer');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);
	return {
		...patch,
		errorCode: asNullableString(patch.errorCode),
		errorMessage: asNullableString(patch.errorMessage),
		output: patch.output ? sanitizeRecordForPersistence(asRecord(patch.output)) : patch.output,
		report: patch.report ? sanitizeRecordForPersistence(asRecord(patch.report)) : patch.report,
		metadata: patch.metadata
			? sanitizeRecordForPersistence(asRecord(patch.metadata))
			: patch.metadata,
		updatedAt: patch.updatedAt ?? new Date()
	};
}

function validateJobEventInput(
	input: {
		jobId?: unknown;
		targetId?: unknown;
		severity?: unknown;
		code?: unknown;
		message?: unknown;
		details?: unknown;
	},
	now: Date
): JobEventRecord {
	const issues: string[] = [];
	const jobId = asTrimmedString(input.jobId);
	const severity = input.severity ?? 'info';
	const code = asTrimmedString(input.code);
	const message = asTrimmedString(input.message);
	if (!jobId) issues.push('jobId is required');
	if (!jobEventSeverities.includes(severity as JobEventSeverity)) {
		issues.push('severity must be debug, info, warning, or error');
	}
	if (!code) issues.push('code is required');
	if (!message) issues.push('message is required');
	if (issues.length > 0) throw new ServiceValidationError(issues);
	return {
		id: randomUUID(),
		jobId: jobId!,
		targetId: asNullableString(input.targetId),
		severity: severity as JobEventSeverity,
		code: code!,
		message: redactSecretLikeString(message!),
		details: sanitizeRecordForPersistence(asRecord(input.details)),
		createdAt: now
	};
}

function validateJobReportInput(input: {
	jobId?: unknown;
	format?: unknown;
	storageKey?: unknown;
	summary?: unknown;
	generatedBy?: unknown;
	generatedAt?: unknown;
	expiresAt?: unknown;
	metadata?: unknown;
}): JobReportRecord {
	const issues: string[] = [];
	const jobId = asTrimmedString(input.jobId);
	const format = input.format;
	const storageKey = asTrimmedString(input.storageKey);
	if (!jobId) issues.push('jobId is required');
	if (!jobReportFormats.includes(format as JobReportFormat))
		issues.push('format must be json or csv');
	if (!storageKey) issues.push('storageKey is required');
	if (issues.length > 0) throw new ServiceValidationError(issues);
	return {
		id: randomUUID(),
		jobId: jobId!,
		format: format as JobReportFormat,
		storageKey: storageKey!,
		summary: sanitizeRecordForPersistence(asRecord(input.summary)),
		generatedBy: asNullableString(input.generatedBy),
		generatedAt: asDateOrNull(input.generatedAt) ?? new Date(),
		expiresAt: asDateOrNull(input.expiresAt),
		metadata: sanitizeRecordForPersistence(asRecord(input.metadata)),
		createdAt: new Date()
	};
}

function validateWorkspacePolicyInput(
	input: WorkspacePolicyInput,
	now: Date
): WorkspacePolicyRecord {
	const issues: string[] = [];
	const workspaceId = asTrimmedString(input.workspaceId);
	const capability = input.capability;
	const effect = input.effect ?? 'allow';
	const minimumRole = input.minimumRole ?? 'owner';
	const maxTargets =
		input.maxTargets === undefined || input.maxTargets === null
			? null
			: asInteger(input.maxTargets);
	if (!workspaceId) issues.push('workspaceId is required');
	if (!workspacePolicyCapabilities.includes(capability as WorkspacePolicyCapability)) {
		issues.push('capability must be a supported workspace policy capability');
	}
	if (!workspacePolicyEffects.includes(effect as WorkspacePolicyEffect)) {
		issues.push('effect must be allow, deny, approval_required, or reason_required');
	}
	if (!workspacePolicyRoles.includes(minimumRole as WorkspacePolicyRole)) {
		issues.push('minimumRole must be viewer, member, operator, maintainer, or owner');
	}
	if (maxTargets !== null && (maxTargets < 1 || maxTargets > 10_000)) {
		issues.push('maxTargets must be an integer between 1 and 10000');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);
	return {
		id: randomUUID(),
		workspaceId: workspaceId!,
		capability: capability as WorkspacePolicyCapability,
		effect: effect as WorkspacePolicyEffect,
		minimumRole: minimumRole as WorkspacePolicyRole,
		maxTargets,
		requireReason: input.requireReason === true,
		settings: asRecord(input.settings),
		createdAt: now,
		updatedAt: now
	};
}

function validateApprovalRequestInput(
	userId: string,
	input: ApprovalRequestInput,
	now: Date
): ApprovalRequestRecord {
	const issues: string[] = [];
	const capability = input.capability;
	if (!workspacePolicyCapabilities.includes(capability as WorkspacePolicyCapability)) {
		issues.push('capability must be a supported workspace policy capability');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);
	return {
		id: randomUUID(),
		workspaceId: asNullableString(input.workspaceId),
		jobId: asNullableString(input.jobId),
		templateId: asNullableString(input.templateId),
		capability: capability as WorkspacePolicyCapability,
		status: 'pending',
		requestedBy: userId,
		decidedBy: null,
		reason: asNullableString(input.reason),
		decisionReason: null,
		requestedAt: now,
		decidedAt: null,
		expiresAt: input.expiresAt ?? null,
		metadata: asRecord(input.metadata),
		createdAt: now,
		updatedAt: now
	};
}

function validateOperationReasonInput(
	userId: string,
	input: OperationReasonInput
): OperationReasonRecord {
	const issues: string[] = [];
	const capability = input.capability;
	const reason = asTrimmedString(input.reason);
	if (!workspacePolicyCapabilities.includes(capability as WorkspacePolicyCapability)) {
		issues.push('capability must be a supported workspace policy capability');
	}
	if (!reason) issues.push('reason is required');
	if (issues.length > 0) throw new ServiceValidationError(issues);
	return {
		id: randomUUID(),
		workspaceId: asNullableString(input.workspaceId),
		userId,
		hostId: asNullableString(input.hostId),
		jobId: asNullableString(input.jobId),
		templateId: asNullableString(input.templateId),
		capability: capability as WorkspacePolicyCapability,
		reason: reason!,
		metadata: asRecord(input.metadata),
		createdAt: new Date()
	};
}

function validateHostFactsInput(input: HostFactsInput): HostFactsRecord {
	const issues: string[] = [];
	const hostId = asTrimmedString(input.hostId);
	const source = input.source ?? 'ssh';
	if (!hostId) issues.push('hostId is required');
	if (!hostFactSources.includes(source as HostFactSource)) {
		issues.push('source must be ssh, manual, or import');
	}
	if (input.uptimeSeconds !== undefined && input.uptimeSeconds !== null) {
		const uptime = asInteger(input.uptimeSeconds);
		if (uptime === null || uptime < 0) issues.push('uptimeSeconds must be a non-negative integer');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);
	const now = new Date();
	return {
		id: randomUUID(),
		hostId: hostId!,
		workspaceId: asNullableString(input.workspaceId),
		collectedBy: asNullableString(input.collectedBy),
		source: source as HostFactSource,
		osName: asNullableString(input.osName),
		osVersion: asNullableString(input.osVersion),
		kernel: asNullableString(input.kernel),
		uptimeSeconds:
			input.uptimeSeconds === undefined || input.uptimeSeconds === null
				? null
				: asInteger(input.uptimeSeconds),
		cpu: asRecord(input.cpu),
		memory: asRecord(input.memory),
		disk: asRecord(input.disk),
		serviceHints: Array.isArray(input.serviceHints)
			? input.serviceHints.filter(isRecord).map((hint) => ({ ...hint }))
			: [],
		facts: asRecord(input.facts),
		collectedAt: input.collectedAt ?? now,
		createdAt: now,
		updatedAt: now
	};
}

function validateHostHealthInput(input: HostHealthInput): HostHealthRecord {
	const issues: string[] = [];
	const hostId = asTrimmedString(input.hostId);
	const state = input.state ?? 'unknown';
	const consecutiveFailures = asInteger(input.consecutiveFailures ?? 0);
	if (!hostId) issues.push('hostId is required');
	if (!hostHealthStates.includes(state as HostHealthState)) {
		issues.push('state must be a supported host health state');
	}
	if (consecutiveFailures === null || consecutiveFailures < 0) {
		issues.push('consecutiveFailures must be a non-negative integer');
	}
	if (issues.length > 0) throw new ServiceValidationError(issues);
	const now = new Date();
	return {
		id: randomUUID(),
		hostId: hostId!,
		workspaceId: asNullableString(input.workspaceId),
		state: state as HostHealthState,
		lastSuccessfulConnectionAt: input.lastSuccessfulConnectionAt ?? null,
		lastFailedConnectionAt: input.lastFailedConnectionAt ?? null,
		consecutiveFailures: consecutiveFailures!,
		failureReason: asNullableString(input.failureReason),
		checkedAt: input.checkedAt ?? now,
		nextCheckAt: input.nextCheckAt ?? null,
		metadata: asRecord(input.metadata),
		createdAt: now,
		updatedAt: now
	};
}

function toAutomationTemplateRecord(row: AutomationTemplateRow): AutomationTemplateRecord {
	return {
		...row,
		metadata: row.metadata ?? {},
		definition: row.definition ?? {},
		variables: row.variables ?? []
	};
}

function toBackgroundJobRecord(row: BackgroundJobRow): BackgroundJobRecord {
	return { ...row, request: row.request ?? {}, metadata: row.metadata ?? {} };
}

function toJobTargetRecord(row: JobTargetRow): JobTargetRecord {
	return {
		...row,
		output: row.output ?? {},
		report: row.report ?? {},
		metadata: row.metadata ?? {}
	};
}

function toJobEventRecord(row: JobEventRow): JobEventRecord {
	return { ...row, details: row.details ?? {} };
}

function toJobReportRecord(row: JobReportRow): JobReportRecord {
	return { ...row, summary: row.summary ?? {}, metadata: row.metadata ?? {} };
}

function toWorkspacePolicyRecord(row: WorkspacePolicyRow): WorkspacePolicyRecord {
	return {
		...row,
		minimumRole: row.minimumRole as WorkspacePolicyRole,
		settings: row.settings ?? {}
	};
}

function toApprovalRequestRecord(row: ApprovalRequestRow): ApprovalRequestRecord {
	return { ...row, metadata: row.metadata ?? {} };
}

function toOperationReasonRecord(row: OperationReasonRow): OperationReasonRecord {
	return { ...row, metadata: row.metadata ?? {} };
}

function toHostFactsRecord(row: HostFactsRow): HostFactsRecord {
	return {
		...row,
		cpu: row.cpu ?? {},
		memory: row.memory ?? {},
		disk: row.disk ?? {},
		serviceHints: row.serviceHints ?? [],
		facts: row.facts ?? {}
	};
}

function toHostHealthRecord(row: HostHealthRow): HostHealthRecord {
	return { ...row, metadata: row.metadata ?? {} };
}

function backgroundJobPatchToDb(
	patch: Partial<BackgroundJobRecord>
): Partial<typeof backgroundJobs.$inferInsert> {
	return {
		status: patch.status,
		completedCount: patch.completedCount,
		failedCount: patch.failedCount,
		skippedCount: patch.skippedCount,
		cancellationRequestedAt: patch.cancellationRequestedAt,
		startedAt: patch.startedAt,
		finishedAt: patch.finishedAt,
		metadata: patch.metadata,
		updatedAt: patch.updatedAt
	};
}

function jobTargetPatchToDb(patch: JobTargetPatch): Partial<typeof jobTargets.$inferInsert> {
	return {
		status: patch.status,
		attempt: patch.attempt,
		startedAt: patch.startedAt,
		finishedAt: patch.finishedAt,
		errorCode: patch.errorCode,
		errorMessage: patch.errorMessage,
		output: patch.output,
		report: patch.report,
		metadata: patch.metadata,
		updatedAt: patch.updatedAt
	};
}

function workspacePolicyPatchToDb(
	policy: WorkspacePolicyRecord
): Partial<typeof workspacePolicies.$inferInsert> {
	return {
		effect: policy.effect,
		minimumRole: policy.minimumRole,
		maxTargets: policy.maxTargets,
		requireReason: policy.requireReason,
		settings: policy.settings,
		updatedAt: policy.updatedAt
	};
}

function approvalRequestPatchToDb(
	patch: Partial<ApprovalRequestRecord>
): Partial<typeof approvalRequests.$inferInsert> {
	return {
		status: patch.status,
		decidedBy: patch.decidedBy,
		decisionReason: patch.decisionReason,
		decidedAt: patch.decidedAt,
		metadata: patch.metadata,
		updatedAt: patch.updatedAt
	};
}

function hostFactsPatchToDb(facts: HostFactsRecord): Partial<typeof hostFacts.$inferInsert> {
	return {
		workspaceId: facts.workspaceId,
		collectedBy: facts.collectedBy,
		source: facts.source,
		osName: facts.osName,
		osVersion: facts.osVersion,
		kernel: facts.kernel,
		uptimeSeconds: facts.uptimeSeconds,
		cpu: facts.cpu,
		memory: facts.memory,
		disk: facts.disk,
		serviceHints: facts.serviceHints,
		facts: facts.facts,
		collectedAt: facts.collectedAt,
		updatedAt: facts.updatedAt
	};
}

function hostHealthPatchToDb(health: HostHealthRecord): Partial<typeof hostHealth.$inferInsert> {
	return {
		workspaceId: health.workspaceId,
		state: health.state,
		lastSuccessfulConnectionAt: health.lastSuccessfulConnectionAt,
		lastFailedConnectionAt: health.lastFailedConnectionAt,
		consecutiveFailures: health.consecutiveFailures,
		failureReason: health.failureReason,
		checkedAt: health.checkedAt,
		nextCheckAt: health.nextCheckAt,
		metadata: health.metadata,
		updatedAt: health.updatedAt
	};
}

function hasRequiredRole(actual: WorkspacePolicyRole, required: WorkspacePolicyRole): boolean {
	return workspacePolicyRoles.indexOf(actual) >= workspacePolicyRoles.indexOf(required);
}

function workspacePolicyKey(workspaceId: string, capability: WorkspacePolicyCapability): string {
	return `${workspaceId}:${capability}`;
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(asTrimmedString).filter((item): item is string => Boolean(item)))];
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function asNullableString(value: unknown): string | null {
	return asTrimmedString(value);
}

function asInteger(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : null;
}

function asDateOrNull(value: unknown): Date | null {
	if (value === undefined || value === null) return null;
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	return null;
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? { ...value } : {};
}

function sanitizeRecordForPersistence(record: Record<string, unknown>): Record<string, unknown> {
	return sanitizePersistenceValue(record) as Record<string, unknown>;
}

function sanitizePersistenceValue(value: unknown, key = ''): unknown {
	if (secretKeyPattern.test(key)) return '[REDACTED]';
	if (typeof value === 'string') return redactSecretLikeString(value);
	if (Array.isArray(value)) return value.map((item) => sanitizePersistenceValue(item));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([entryKey, entryValue]) => [
			entryKey,
			sanitizePersistenceValue(entryValue, entryKey)
		])
	);
}

function redactSecretLikeString(value: string): string {
	return value
		.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
		.replace(
			/(password|passwd|passphrase|secret|token|api[_-]?key)\s*[:=]\s*([^\s,;"']+)/gi,
			'$1=[REDACTED]'
		)
		.replace(
			/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,
			'[REDACTED PRIVATE KEY]'
		);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const v6ResourcesService = new V6ResourcesService();
