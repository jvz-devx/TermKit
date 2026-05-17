import { randomUUID } from 'node:crypto';
import { ServiceNotFoundError, ServiceValidationError } from '../errors';
import { DrizzleV6ResourcesRepository } from './repository';
import type {
	ApprovalRequestInput,
	ApprovalRequestRecord,
	ApprovalRequestStatus,
	AutomationTemplateInput,
	AutomationTemplateRecord,
	BackgroundJobInput,
	BackgroundJobRecord,
	HostFactsInput,
	HostFactsRecord,
	HostHealthInput,
	HostHealthRecord,
	JobEventRecord,
	JobReportRecord,
	JobTargetPatch,
	JobTargetRecord,
	OperationReasonInput,
	OperationReasonRecord,
	PolicyEvaluation,
	PolicyEvaluationInput,
	V6ResourcesRepository,
	WorkspacePolicyInput,
	WorkspacePolicyRecord
} from './types';
import {
	asTrimmedString,
	hasRequiredRole,
	validateApprovalRequestInput,
	validateAutomationTemplateInput,
	validateBackgroundJobInput,
	validateHostFactsInput,
	validateHostHealthInput,
	validateJobEventInput,
	validateJobReportInput,
	validateJobTargetPatch,
	validateOperationReasonInput,
	validateWorkspacePolicyInput
} from './validation';

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
export const v6ResourcesService = new V6ResourcesService();
