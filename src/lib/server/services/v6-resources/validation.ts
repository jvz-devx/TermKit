import { randomUUID } from 'node:crypto';
import { ServiceValidationError } from '../errors';
import {
	automationTemplateKinds,
	automationTemplateVisibilities,
	automationVariableKinds,
	backgroundJobKinds,
	hostFactSources,
	hostHealthStates,
	jobEventSeverities,
	jobReportFormats,
	jobTargetStatuses,
	workspacePolicyCapabilities,
	workspacePolicyEffects,
	workspacePolicyRoles,
	type ApprovalRequestInput,
	type ApprovalRequestRecord,
	type AutomationTemplateInput,
	type AutomationTemplateKind,
	type AutomationTemplateRecord,
	type AutomationTemplateVisibility,
	type AutomationVariable,
	type AutomationVariableKind,
	type BackgroundJobInput,
	type BackgroundJobKind,
	type HostFactSource,
	type HostFactsInput,
	type HostFactsRecord,
	type HostHealthInput,
	type HostHealthRecord,
	type HostHealthState,
	type JobEventRecord,
	type JobEventSeverity,
	type JobReportFormat,
	type JobReportRecord,
	type JobTargetPatch,
	type OperationReasonInput,
	type OperationReasonRecord,
	type WorkspacePolicyCapability,
	type WorkspacePolicyEffect,
	type WorkspacePolicyInput,
	type WorkspacePolicyRecord,
	type WorkspacePolicyRole
} from './types';

const secretKeyPattern = /(password|passwd|passphrase|secret|token|api[_-]?key|private[_-]?key)/i;

export function validateAutomationTemplateInput(
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

export function validateAutomationVariables(
	value: unknown,
	issues: string[]
): AutomationVariable[] {
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

export function validateBackgroundJobInput(input: BackgroundJobInput): {
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

export function validateJobTargetPatch(patch: JobTargetPatch): JobTargetPatch {
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

export function validateJobEventInput(
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

export function validateJobReportInput(input: {
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

export function validateWorkspacePolicyInput(
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

export function validateApprovalRequestInput(
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

export function validateOperationReasonInput(
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

export function validateHostFactsInput(input: HostFactsInput): HostFactsRecord {
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

export function validateHostHealthInput(input: HostHealthInput): HostHealthRecord {
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
export function hasRequiredRole(
	actual: WorkspacePolicyRole,
	required: WorkspacePolicyRole
): boolean {
	return workspacePolicyRoles.indexOf(actual) >= workspacePolicyRoles.indexOf(required);
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(asTrimmedString).filter((item): item is string => Boolean(item)))];
}

export function asTrimmedString(value: unknown): string | null {
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
