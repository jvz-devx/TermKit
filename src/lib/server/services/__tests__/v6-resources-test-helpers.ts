import type {
	ApprovalRequestRecord,
	AutomationTemplateRecord,
	BackgroundJobRecord,
	HostFactsRecord,
	HostHealthRecord,
	JobEventRecord,
	JobReportRecord,
	JobTargetRecord,
	OperationReasonRecord,
	WorkspacePolicyRecord
} from '../v6-resources';

export class QueuedDrizzleDatabase {
	readonly updatePatches: unknown[] = [];
	readonly conflictPatches: unknown[] = [];

	constructor(
		private readonly queues: {
			selectRows: unknown[][];
			insertRows: unknown[][];
			updateRows: unknown[][];
		}
	) {}

	select() {
		return {
			from: () => ({
				where: () => rowsWithLimit(this.queues.selectRows.shift() ?? [])
			})
		};
	}

	insert() {
		return {
			values: () => {
				const rows = this.queues.insertRows.shift() ?? [];
				const returning = () => rows;
				return {
					returning,
					onConflictDoUpdate: (config: { set: unknown }) => {
						this.conflictPatches.push(config.set);
						return { returning };
					}
				};
			}
		};
	}

	update() {
		return {
			set: (patch: unknown) => {
				this.updatePatches.push(patch);
				return {
					where: () => ({
						returning: () => this.queues.updateRows.shift() ?? []
					})
				};
			}
		};
	}

	transaction<T>(callback: (transaction: Pick<QueuedDrizzleDatabase, 'insert'>) => T): T {
		return callback({ insert: this.insert.bind(this) });
	}
}

export function rowsWithLimit(rows: unknown[]) {
	return Object.assign([...rows], {
		limit: (count: number) => rows.slice(0, count)
	});
}

export function automationTemplate(
	patch: Partial<AutomationTemplateRecord> = {}
): AutomationTemplateRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'template-1',
		userId: 'owner-1',
		workspaceId: null as never,
		name: 'Restart service',
		kind: 'ssh_command',
		visibility: 'private',
		version: 1,
		description: null as never,
		definition: { command: 'systemctl restart sshd' },
		variables: [],
		isDangerous: false,
		requiresApproval: false,
		lastUsedAt: null as never,
		usageCount: 0,
		updatedBy: 'owner-1',
		metadata: { source: 'test' },
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function backgroundJob(patch: Partial<BackgroundJobRecord> = {}): BackgroundJobRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'job-1',
		userId: 'operator-1',
		workspaceId: null as never,
		templateId: null as never,
		templateVersion: null as never,
		kind: 'bulk_ssh_command',
		status: 'pending',
		title: 'Patch hosts',
		request: { command: 'uptime' },
		targetCount: 1,
		completedCount: 0,
		failedCount: 0,
		skippedCount: 0,
		concurrencyLimit: 1,
		reason: null as never,
		cancellationRequestedAt: null as never,
		startedAt: null as never,
		finishedAt: null as never,
		retentionExpiresAt: null as never,
		metadata: { rollout: 'v7' },
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function jobTarget(patch: Partial<JobTargetRecord> = {}): JobTargetRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'target-1',
		jobId: 'job-1',
		hostId: 'host-1',
		status: 'pending',
		attempt: 0,
		maxAttempts: 1,
		startedAt: null as never,
		finishedAt: null as never,
		errorCode: null as never,
		errorMessage: null as never,
		output: { stdout: 'ok' },
		report: { changed: true },
		metadata: { retry: false },
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function jobEvent(patch: Partial<JobEventRecord> = {}): JobEventRecord {
	return {
		id: 'event-1',
		jobId: 'job-1',
		targetId: null as never,
		severity: 'info',
		code: 'job.started',
		message: 'Job started',
		details: { targetCount: 1 },
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		...patch
	};
}

export function jobReport(patch: Partial<JobReportRecord> = {}): JobReportRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'report-1',
		jobId: 'job-1',
		format: 'json',
		storageKey: 'reports/job-1.json',
		summary: { completed: 1 },
		generatedBy: 'operator-1',
		generatedAt: now,
		expiresAt: null as never,
		metadata: { retained: true },
		createdAt: now,
		...patch
	};
}

export function workspacePolicy(patch: Partial<WorkspacePolicyRecord> = {}): WorkspacePolicyRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'policy-1',
		workspaceId: 'workspace-1',
		capability: 'bulk_job',
		effect: 'approval_required',
		minimumRole: 'operator',
		maxTargets: 100,
		requireReason: true,
		settings: { window: 'maintenance' },
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function approvalRequest(patch: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'approval-1',
		workspaceId: 'workspace-1',
		jobId: 'job-1',
		templateId: null as never,
		capability: 'bulk_job',
		status: 'pending',
		requestedBy: 'operator-1',
		decidedBy: null as never,
		reason: 'Patch hosts',
		decisionReason: null as never,
		requestedAt: now,
		decidedAt: null as never,
		expiresAt: null as never,
		metadata: { source: 'test' },
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function operationReason(patch: Partial<OperationReasonRecord> = {}): OperationReasonRecord {
	return {
		id: 'reason-1',
		workspaceId: 'workspace-1',
		userId: 'operator-1',
		hostId: 'host-1',
		jobId: 'job-1',
		templateId: null as never,
		capability: 'bulk_job',
		reason: 'Patch hosts',
		metadata: { source: 'test' },
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		...patch
	};
}

export function hostFacts(patch: Partial<HostFactsRecord> = {}): HostFactsRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'facts-1',
		hostId: 'host-1',
		workspaceId: 'workspace-1',
		collectedBy: 'operator-1',
		source: 'ssh',
		osName: 'NixOS',
		osVersion: '25.05',
		kernel: '6.12.1',
		uptimeSeconds: 3600,
		cpu: { cores: 8 },
		memory: { totalMiB: 32768 },
		disk: { rootGiB: 512 },
		serviceHints: [{ name: 'sshd', state: 'running' }],
		facts: { arch: 'x86_64' },
		collectedAt: now,
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function hostHealth(patch: Partial<HostHealthRecord> = {}): HostHealthRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'health-1',
		hostId: 'host-1',
		workspaceId: 'workspace-1',
		state: 'healthy',
		lastSuccessfulConnectionAt: now,
		lastFailedConnectionAt: null as never,
		consecutiveFailures: 0,
		failureReason: null as never,
		checkedAt: now,
		nextCheckAt: null as never,
		metadata: { checkedBy: 'probe' },
		createdAt: now,
		updatedAt: now,
		...patch
	};
}
