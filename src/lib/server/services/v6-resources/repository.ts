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
import type {
	ApprovalRequestRecord,
	AutomationTemplateRecord,
	BackgroundJobRecord,
	HostFactsRecord,
	HostHealthRecord,
	JobEventRecord,
	JobReportRecord,
	JobTargetPatch,
	JobTargetRecord,
	OperationReasonRecord,
	V6ResourcesRepository,
	WorkspacePolicyCapability,
	WorkspacePolicyRecord,
	WorkspacePolicyRole
} from './types';

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

function workspacePolicyKey(workspaceId: string, capability: WorkspacePolicyCapability): string {
	return `${workspaceId}:${capability}`;
}
