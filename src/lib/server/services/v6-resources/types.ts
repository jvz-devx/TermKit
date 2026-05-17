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
