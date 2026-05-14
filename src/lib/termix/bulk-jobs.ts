import { randomUUID } from 'node:crypto';

const defaultMaxOutputBytes = 64 * 1024;
const maxConcurrencyLimit = 25;
const secretKeyPattern = /(password|passwd|passphrase|secret|token|api[_-]?key|private[_-]?key)/i;

export const bulkJobKinds = ['ssh_command', 'transfer'] as const;
export type BulkJobKind = (typeof bulkJobKinds)[number];

export const bulkTransferProtocols = ['sftp', 'ftp', 'ftps'] as const;
export type BulkTransferProtocol = (typeof bulkTransferProtocols)[number];

export const bulkTransferActions = ['download', 'upload', 'delete', 'mkdir', 'rename'] as const;
export type BulkTransferAction = (typeof bulkTransferActions)[number];

export const bulkJobStatuses = [
	'planned',
	'queued',
	'running',
	'completed',
	'partial_failed',
	'failed',
	'cancelling',
	'cancelled'
] as const;
export type BulkJobStatus = (typeof bulkJobStatuses)[number];

export const bulkHostStatuses = [
	'queued',
	'running',
	'succeeded',
	'failed',
	'cancelled',
	'skipped'
] as const;
export type BulkHostStatus = (typeof bulkHostStatuses)[number];

export type BulkFailureCode =
	| 'access_denied'
	| 'auth_failed'
	| 'cancelled'
	| 'command_failed'
	| 'connection_failed'
	| 'host_unreachable'
	| 'not_retryable'
	| 'runner_failed'
	| 'timeout'
	| 'transfer_failed'
	| 'validation_failed';

export type BulkHostTarget = {
	hostId: string;
	hostName?: string | null;
	protocol?: 'ssh' | BulkTransferProtocol | string | null;
};

export type BulkSshCommandSpec = {
	command: string;
	cwd?: string | null;
	env?: Record<string, string>;
	timeoutMs?: number | null;
};

export type BulkTransferSpec = {
	protocol: BulkTransferProtocol;
	action: BulkTransferAction;
	remotePath: string;
	destinationPath?: string | null;
	sourcePath?: string | null;
	toPath?: string | null;
	overwrite?: boolean;
};

export type BulkRetryPolicy = {
	maxAttempts: number;
	retryableCodes: BulkFailureCode[];
};

export type BulkOutputPolicy = {
	maxBytes: number;
	redactionValues: string[];
};

export type BulkConcurrencyPlan = {
	limit: number;
	totalHosts: number;
	waveCount: number;
	waves: string[][];
};

export type BulkHostFailure = {
	code: BulkFailureCode;
	message: string;
	retryable: boolean;
	at: Date;
};

export type BulkCapturedOutput = {
	text: string;
	originalBytes: number;
	truncated: boolean;
	redacted: boolean;
};

export type BulkHostResult = {
	exitCode?: number | null;
	stdout: BulkCapturedOutput;
	stderr: BulkCapturedOutput;
	bytesTransferred?: number | null;
	report?: Record<string, string | number | boolean | null>;
};

export type BulkHostJob = BulkHostTarget & {
	status: BulkHostStatus;
	attempt: number;
	startedAt: Date | null;
	finishedAt: Date | null;
	failure: BulkHostFailure | null;
	result: BulkHostResult | null;
};

export type BulkJobRecord = {
	id: string;
	userId: string;
	kind: BulkJobKind;
	status: BulkJobStatus;
	reviewedHostIds: string[];
	hosts: BulkHostJob[];
	concurrency: BulkConcurrencyPlan;
	command: BulkSshCommandSpec | null;
	transfer: BulkTransferSpec | null;
	retry: BulkRetryPolicy;
	output: BulkOutputPolicy;
	createdAt: Date;
	updatedAt: Date;
	startedAt: Date | null;
	finishedAt: Date | null;
	cancelledAt: Date | null;
};

export type BulkJobPlanInput = {
	id?: string;
	userId: string;
	kind: BulkJobKind;
	targets: BulkHostTarget[];
	reviewedHostIds: string[];
	concurrencyLimit?: number | null;
	command?: BulkSshCommandSpec | null;
	transfer?: BulkTransferSpec | null;
	retry?: Partial<BulkRetryPolicy> | null;
	output?: Partial<BulkOutputPolicy> | null;
	now?: Date;
};

export type BulkHostExecutionResult = {
	exitCode?: number | null;
	stdout?: string | Buffer | null;
	stderr?: string | Buffer | null;
	bytesTransferred?: number | null;
	report?: Record<string, string | number | boolean | null>;
};

export type BulkHostExecutionFailure = {
	code?: BulkFailureCode;
	message?: string;
	retryable?: boolean;
	stdout?: string | Buffer | null;
	stderr?: string | Buffer | null;
	exitCode?: number | null;
	bytesTransferred?: number | null;
	report?: Record<string, string | number | boolean | null>;
};

export class BulkJobValidationError extends Error {
	readonly issues: string[];

	constructor(issues: string[]) {
		super(issues.join('; '));
		this.name = 'BulkJobValidationError';
		this.issues = issues;
	}
}

export class BulkJobNotRetryableError extends Error {
	constructor(message = 'No failed hosts are eligible for retry') {
		super(message);
		this.name = 'BulkJobNotRetryableError';
	}
}

export function planBulkJob(input: BulkJobPlanInput): BulkJobRecord {
	const issues: string[] = [];
	const now = input.now ?? new Date();
	const userId = asTrimmedString(input.userId);
	const kind = input.kind;
	const targets = normalizeTargets(input.targets, issues);
	const reviewedHostIds = normalizeReviewedHostIds(input.reviewedHostIds, issues);
	const concurrencyLimit = normalizeConcurrencyLimit(input.concurrencyLimit, issues);
	const retry = normalizeRetryPolicy(input.retry, issues);
	const output = normalizeOutputPolicy(input.output, issues);
	const command = kind === 'ssh_command' ? normalizeCommand(input.command, issues) : null;
	const transfer = kind === 'transfer' ? normalizeTransfer(input.transfer, issues) : null;

	if (!userId) issues.push('userId is required');
	if (!bulkJobKinds.includes(kind)) issues.push('kind must be ssh_command or transfer');
	validateReviewedHostSet(targets, reviewedHostIds, issues);
	validateTargetProtocols(kind, targets, transfer, issues);

	if (kind === 'ssh_command' && input.transfer) {
		issues.push('transfer must not be provided for SSH command jobs');
	}
	if (kind === 'transfer' && input.command) {
		issues.push('command must not be provided for transfer jobs');
	}

	if (issues.length > 0) throw new BulkJobValidationError(issues);

	return {
		id: input.id ?? randomUUID(),
		userId: userId!,
		kind,
		status: 'queued',
		reviewedHostIds,
		hosts: targets.map((target) => ({
			...target,
			status: 'queued',
			attempt: 0,
			startedAt: null,
			finishedAt: null,
			failure: null,
			result: null
		})),
		concurrency: buildConcurrencyPlan(targets, concurrencyLimit),
		command,
		transfer,
		retry,
		output,
		createdAt: now,
		updatedAt: now,
		startedAt: null,
		finishedAt: null,
		cancelledAt: null
	};
}

export function startBulkJob(job: BulkJobRecord, now = new Date()): BulkJobRecord {
	if (job.status === 'cancelled') return job;
	return {
		...job,
		status: 'running',
		startedAt: job.startedAt ?? now,
		updatedAt: now
	};
}

export function markBulkHostRunning(
	job: BulkJobRecord,
	hostId: string,
	now = new Date()
): BulkJobRecord {
	return updateHost(
		job,
		hostId,
		(host) => ({
			...host,
			status: 'running',
			attempt: host.attempt + 1,
			startedAt: now,
			finishedAt: null,
			failure: null,
			result: null
		}),
		now
	);
}

export function markBulkHostSucceeded(
	job: BulkJobRecord,
	hostId: string,
	result: BulkHostExecutionResult,
	now = new Date()
): BulkJobRecord {
	const next = updateHost(
		job,
		hostId,
		(host) => ({
			...host,
			status: 'succeeded',
			finishedAt: now,
			failure: null,
			result: toHostResult(result, job.output)
		}),
		now
	);
	return finalizeBulkJobIfSettled(next, now);
}

export function markBulkHostFailed(
	job: BulkJobRecord,
	hostId: string,
	failure: BulkHostExecutionFailure | Error | unknown,
	now = new Date()
): BulkJobRecord {
	const normalized = normalizeExecutionFailure(failure, job.retry, now);
	const next = updateHost(
		job,
		hostId,
		(host) => ({
			...host,
			status: 'failed',
			finishedAt: now,
			failure: {
				code: normalized.code,
				message: normalized.message,
				retryable: normalized.retryable && host.attempt < job.retry.maxAttempts,
				at: now
			},
			result: toHostResult(normalized, job.output)
		}),
		now
	);
	return finalizeBulkJobIfSettled(next, now);
}

export function markBulkHostCancelled(
	job: BulkJobRecord,
	hostId: string,
	now = new Date()
): BulkJobRecord {
	const next = updateHost(
		job,
		hostId,
		(host) => ({
			...host,
			status: 'cancelled',
			finishedAt: now,
			failure: {
				code: 'cancelled',
				message: 'Host operation was cancelled',
				retryable: false,
				at: now
			}
		}),
		now
	);
	return finalizeBulkJobIfSettled(next, now);
}

export function cancelBulkJob(job: BulkJobRecord, now = new Date()): BulkJobRecord {
	const hosts = job.hosts.map((host) => {
		if (host.status === 'queued' || host.status === 'running') {
			return {
				...host,
				status: 'cancelled' as const,
				finishedAt: now,
				failure: {
					code: 'cancelled' as const,
					message: 'Job was cancelled',
					retryable: false,
					at: now
				}
			};
		}
		return host;
	});
	return {
		...job,
		status: 'cancelled',
		hosts,
		cancelledAt: job.cancelledAt ?? now,
		finishedAt: job.finishedAt ?? now,
		updatedAt: now
	};
}

export function queueRetryableBulkHosts(job: BulkJobRecord, now = new Date()): BulkJobRecord {
	const retryableHostIds = getRetryableBulkHostIds(job);
	if (retryableHostIds.length === 0) throw new BulkJobNotRetryableError();
	const retryable = new Set(retryableHostIds);
	return {
		...job,
		status: 'queued',
		hosts: job.hosts.map((host) =>
			retryable.has(host.hostId)
				? {
						...host,
						status: 'queued',
						startedAt: null,
						finishedAt: null,
						failure: null,
						result: null
					}
				: host
		),
		cancelledAt: null,
		finishedAt: null,
		updatedAt: now
	};
}

export function getRetryableBulkHostIds(job: BulkJobRecord): string[] {
	return job.hosts
		.filter(
			(host) =>
				host.status === 'failed' &&
				host.failure?.retryable === true &&
				host.attempt < job.retry.maxAttempts
		)
		.map((host) => host.hostId);
}

export function captureBulkOutput(
	value: string | Buffer | null | undefined,
	policy: BulkOutputPolicy
): BulkCapturedOutput {
	const source = Buffer.isBuffer(value) ? value.toString('utf8') : (value ?? '');
	const originalBytes = Buffer.byteLength(source, 'utf8');
	const redacted = redactText(source, policy.redactionValues);
	const redactedBytes = Buffer.byteLength(redacted.text, 'utf8');
	if (redactedBytes <= policy.maxBytes) {
		return {
			text: redacted.text,
			originalBytes,
			truncated: false,
			redacted: redacted.redacted
		};
	}

	return {
		text: truncateUtf8(redacted.text, policy.maxBytes),
		originalBytes,
		truncated: true,
		redacted: redacted.redacted
	};
}

export function buildBulkJobReport(
	job: BulkJobRecord,
	format: 'json' | 'csv' = 'json'
): { filename: string; mimeType: string; body: string } {
	const safe = toReportModel(job);
	if (format === 'csv') {
		return {
			filename: `bulk-job-${job.id}.csv`,
			mimeType: 'text/csv',
			body: toCsvReport(safe)
		};
	}

	return {
		filename: `bulk-job-${job.id}.json`,
		mimeType: 'application/json',
		body: `${JSON.stringify(safe, null, 2)}\n`
	};
}

export function summarizeBulkJob(job: BulkJobRecord): {
	total: number;
	succeeded: number;
	failed: number;
	cancelled: number;
	queued: number;
	running: number;
	partialFailure: boolean;
} {
	const count = (status: BulkHostStatus) =>
		job.hosts.filter((host) => host.status === status).length;
	const failed = count('failed');
	const cancelled = count('cancelled');
	const succeeded = count('succeeded');
	return {
		total: job.hosts.length,
		succeeded,
		failed,
		cancelled,
		queued: count('queued'),
		running: count('running'),
		partialFailure: succeeded > 0 && failed + cancelled > 0
	};
}

function finalizeBulkJobIfSettled(job: BulkJobRecord, now: Date): BulkJobRecord {
	if (job.hosts.some((host) => host.status === 'queued' || host.status === 'running')) {
		return {
			...job,
			status: job.status === 'planned' || job.status === 'queued' ? 'running' : job.status,
			updatedAt: now
		};
	}

	const summary = summarizeBulkJob(job);
	const status: BulkJobStatus =
		summary.failed + summary.cancelled === 0
			? 'completed'
			: summary.succeeded > 0
				? 'partial_failed'
				: summary.cancelled > 0 && summary.failed === 0
					? 'cancelled'
					: 'failed';

	return {
		...job,
		status,
		finishedAt: job.finishedAt ?? now,
		cancelledAt: status === 'cancelled' ? (job.cancelledAt ?? now) : job.cancelledAt,
		updatedAt: now
	};
}

function updateHost(
	job: BulkJobRecord,
	hostId: string,
	update: (host: BulkHostJob) => BulkHostJob,
	now: Date
): BulkJobRecord {
	return {
		...job,
		hosts: job.hosts.map((host) => (host.hostId === hostId ? update(host) : host)),
		updatedAt: now
	};
}

function toHostResult(
	result: BulkHostExecutionResult | BulkHostExecutionFailure,
	policy: BulkOutputPolicy
): BulkHostResult {
	return {
		exitCode: result.exitCode ?? null,
		stdout: captureBulkOutput(result.stdout, policy),
		stderr: captureBulkOutput(result.stderr, policy),
		bytesTransferred: result.bytesTransferred ?? null,
		report: sanitizeReportFields(result.report ?? {}, policy.redactionValues)
	};
}

function normalizeExecutionFailure(
	failure: BulkHostExecutionFailure | Error | unknown,
	retry: BulkRetryPolicy,
	now: Date
): Required<Pick<BulkHostExecutionFailure, 'code' | 'message' | 'retryable'>> &
	BulkHostExecutionFailure {
	if (isExecutionFailure(failure)) {
		const code = failure.code ?? 'runner_failed';
		return {
			...failure,
			code,
			message: failure.message ?? 'Bulk host operation failed',
			retryable: failure.retryable ?? retry.retryableCodes.includes(code)
		};
	}

	const message = failure instanceof Error ? failure.message : 'Bulk host operation failed';
	const code: BulkFailureCode = isAbortMessage(message) ? 'cancelled' : 'runner_failed';
	return {
		code,
		message,
		retryable: code !== 'cancelled' && retry.retryableCodes.includes(code),
		stdout: null,
		stderr: null,
		exitCode: null,
		bytesTransferred: null,
		report: { failedAt: now.toISOString() }
	};
}

function normalizeTargets(targets: BulkHostTarget[], issues: string[]): BulkHostTarget[] {
	if (!Array.isArray(targets) || targets.length === 0) {
		issues.push('targets must contain at least one host');
		return [];
	}

	const seen = new Set<string>();
	const normalized: BulkHostTarget[] = [];
	for (const [index, target] of targets.entries()) {
		const hostId = asTrimmedString(target?.hostId);
		if (!hostId) {
			issues.push(`targets[${index}].hostId is required`);
			continue;
		}
		if (seen.has(hostId)) {
			issues.push(`targets[${index}].hostId duplicates ${hostId}`);
			continue;
		}
		seen.add(hostId);
		normalized.push({
			hostId,
			hostName: asTrimmedString(target.hostName),
			protocol: asTrimmedString(target.protocol)
		});
	}
	return normalized;
}

function normalizeReviewedHostIds(reviewedHostIds: string[], issues: string[]): string[] {
	if (!Array.isArray(reviewedHostIds) || reviewedHostIds.length === 0) {
		issues.push('reviewedHostIds must contain the explicitly reviewed host set');
		return [];
	}
	return [
		...new Set(reviewedHostIds.map(asTrimmedString).filter((id): id is string => Boolean(id)))
	];
}

function normalizeConcurrencyLimit(value: number | null | undefined, issues: string[]): number {
	const limit = value ?? 5;
	if (!Number.isInteger(limit) || limit < 1 || limit > maxConcurrencyLimit) {
		issues.push(`concurrencyLimit must be an integer between 1 and ${maxConcurrencyLimit}`);
		return 1;
	}
	return limit;
}

function normalizeRetryPolicy(
	value: Partial<BulkRetryPolicy> | null | undefined,
	issues: string[]
): BulkRetryPolicy {
	const maxAttempts = value?.maxAttempts ?? 1;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
		issues.push('retry.maxAttempts must be an integer between 1 and 5');
	}
	const retryableCodes = value?.retryableCodes ?? [
		'connection_failed',
		'host_unreachable',
		'timeout',
		'runner_failed',
		'transfer_failed'
	];
	return {
		maxAttempts: Number.isInteger(maxAttempts) ? maxAttempts : 1,
		retryableCodes: retryableCodes.filter((code): code is BulkFailureCode =>
			isBulkFailureCode(code)
		)
	};
}

function normalizeOutputPolicy(
	value: Partial<BulkOutputPolicy> | null | undefined,
	issues: string[]
): BulkOutputPolicy {
	const maxBytes = value?.maxBytes ?? defaultMaxOutputBytes;
	if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 * 1024) {
		issues.push('output.maxBytes must be an integer between 1024 and 1048576');
	}
	return {
		maxBytes: Number.isInteger(maxBytes) ? maxBytes : defaultMaxOutputBytes,
		redactionValues: Array.isArray(value?.redactionValues)
			? value.redactionValues.filter((item) => typeof item === 'string' && item.length > 0)
			: []
	};
}

function normalizeCommand(
	command: BulkSshCommandSpec | null | undefined,
	issues: string[]
): BulkSshCommandSpec | null {
	const commandText = asTrimmedString(command?.command);
	if (!commandText) {
		issues.push('command.command is required for SSH command jobs');
		return null;
	}
	if (commandText.includes('\0')) issues.push('command.command cannot contain NUL bytes');
	if (commandText.length > 4096) issues.push('command.command must be at most 4096 characters');

	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(command?.env ?? {})) {
		if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
			issues.push(`command.env.${key} must be a valid environment variable name`);
			continue;
		}
		if (secretKeyPattern.test(key)) {
			issues.push(`command.env.${key} cannot contain secret-like values`);
			continue;
		}
		env[key] = String(value);
	}

	const timeoutMs = command?.timeoutMs ?? null;
	if (
		timeoutMs !== null &&
		(!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000)
	) {
		issues.push('command.timeoutMs must be between 1000 and 900000 milliseconds');
	}

	return {
		command: commandText,
		cwd: asTrimmedString(command?.cwd),
		env,
		timeoutMs
	};
}

function normalizeTransfer(
	transfer: BulkTransferSpec | null | undefined,
	issues: string[]
): BulkTransferSpec | null {
	if (!transfer) {
		issues.push('transfer is required for transfer jobs');
		return null;
	}
	const protocol = transfer.protocol;
	const action = transfer.action;
	if (!bulkTransferProtocols.includes(protocol))
		issues.push('transfer.protocol must be sftp, ftp, or ftps');
	if (!bulkTransferActions.includes(action)) {
		issues.push('transfer.action must be download, upload, delete, mkdir, or rename');
	}
	const remotePath = validateAbsolutePath(transfer.remotePath, 'transfer.remotePath', issues);
	const sourcePath =
		action === 'upload'
			? validateLocalReference(transfer.sourcePath, 'transfer.sourcePath', issues)
			: asTrimmedString(transfer.sourcePath);
	const destinationPath =
		action === 'download'
			? validateLocalReference(transfer.destinationPath, 'transfer.destinationPath', issues)
			: asTrimmedString(transfer.destinationPath);
	const toPath =
		action === 'rename'
			? validateAbsolutePath(transfer.toPath, 'transfer.toPath', issues)
			: asTrimmedString(transfer.toPath);

	return {
		protocol,
		action,
		remotePath: remotePath ?? '',
		sourcePath,
		destinationPath,
		toPath,
		overwrite: Boolean(transfer.overwrite)
	};
}

function validateReviewedHostSet(
	targets: BulkHostTarget[],
	reviewedHostIds: string[],
	issues: string[]
): void {
	const targetSet = new Set(targets.map((target) => target.hostId));
	const reviewedSet = new Set(reviewedHostIds);
	for (const target of targetSet) {
		if (!reviewedSet.has(target)) issues.push(`host ${target} was not in the reviewed host set`);
	}
	for (const reviewed of reviewedSet) {
		if (!targetSet.has(reviewed)) issues.push(`reviewed host ${reviewed} is not in the target set`);
	}
}

function validateTargetProtocols(
	kind: BulkJobKind,
	targets: BulkHostTarget[],
	transfer: BulkTransferSpec | null,
	issues: string[]
): void {
	for (const target of targets) {
		if (!target.protocol) continue;
		if (kind === 'ssh_command' && target.protocol !== 'ssh') {
			issues.push(`host ${target.hostId} must use ssh for SSH command jobs`);
		}
		if (kind === 'transfer' && transfer && target.protocol !== transfer.protocol) {
			issues.push(`host ${target.hostId} must use ${transfer.protocol} for this transfer job`);
		}
	}
}

function buildConcurrencyPlan(targets: BulkHostTarget[], limit: number): BulkConcurrencyPlan {
	const waves: string[][] = [];
	for (let index = 0; index < targets.length; index += limit) {
		waves.push(targets.slice(index, index + limit).map((target) => target.hostId));
	}
	return {
		limit,
		totalHosts: targets.length,
		waveCount: waves.length,
		waves
	};
}

function validateAbsolutePath(value: unknown, field: string, issues: string[]): string | null {
	const path = asTrimmedString(value);
	if (!path) {
		issues.push(`${field} is required`);
		return null;
	}
	if (path.includes('\0')) issues.push(`${field} cannot contain NUL bytes`);
	if (!path.startsWith('/')) issues.push(`${field} must be absolute`);
	if (path.split('/').includes('..')) issues.push(`${field} cannot contain parent traversal`);
	return path;
}

function validateLocalReference(value: unknown, field: string, issues: string[]): string | null {
	const ref = asTrimmedString(value);
	if (!ref) {
		issues.push(`${field} is required`);
		return null;
	}
	if (ref.includes('\0')) issues.push(`${field} cannot contain NUL bytes`);
	return ref;
}

function redactText(text: string, values: string[]): { text: string; redacted: boolean } {
	let redacted = text;
	for (const value of values) {
		redacted = redacted.split(value).join('[REDACTED]');
	}
	redacted = redacted
		.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
		.replace(
			/(password|passwd|passphrase|secret|token|api[_-]?key)\s*[:=]\s*([^\s,;"']+)/gi,
			'$1=[REDACTED]'
		)
		.replace(
			/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,
			'[REDACTED PRIVATE KEY]'
		);
	return { text: redacted, redacted: redacted !== text };
}

function truncateUtf8(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, 'utf8');
	return (
		buffer
			.subarray(0, maxBytes)
			.toString('utf8')
			.replace(/\uFFFD$/, '') + '\n[truncated]'
	);
}

function toReportModel(job: BulkJobRecord): Record<string, unknown> {
	return {
		id: job.id,
		userId: job.userId,
		kind: job.kind,
		status: job.status,
		summary: summarizeBulkJob(job),
		concurrency: job.concurrency,
		command: job.command
			? {
					command: redactText(job.command.command, job.output.redactionValues).text,
					cwd: job.command.cwd,
					envKeys: Object.keys(job.command.env ?? {}),
					timeoutMs: job.command.timeoutMs
				}
			: null,
		transfer: job.transfer,
		createdAt: job.createdAt.toISOString(),
		startedAt: job.startedAt?.toISOString() ?? null,
		finishedAt: job.finishedAt?.toISOString() ?? null,
		hosts: job.hosts.map((host) => ({
			hostId: host.hostId,
			hostName: host.hostName,
			protocol: host.protocol,
			status: host.status,
			attempt: host.attempt,
			startedAt: host.startedAt?.toISOString() ?? null,
			finishedAt: host.finishedAt?.toISOString() ?? null,
			failure: host.failure
				? {
						code: host.failure.code,
						message: redactText(host.failure.message, job.output.redactionValues).text,
						retryable: host.failure.retryable,
						at: host.failure.at.toISOString()
					}
				: null,
			result: host.result
				? {
						exitCode: host.result.exitCode ?? null,
						bytesTransferred: host.result.bytesTransferred ?? null,
						stdout: summarizeCapturedOutput(host.result.stdout),
						stderr: summarizeCapturedOutput(host.result.stderr),
						report: host.result.report
					}
				: null
		}))
	};
}

function summarizeCapturedOutput(output: BulkCapturedOutput): Omit<BulkCapturedOutput, 'text'> {
	return {
		originalBytes: output.originalBytes,
		truncated: output.truncated,
		redacted: output.redacted
	};
}

function toCsvReport(model: Record<string, unknown>): string {
	const hosts = Array.isArray(model.hosts) ? (model.hosts as Record<string, unknown>[]) : [];
	const rows = [
		[
			'jobId',
			'hostId',
			'hostName',
			'protocol',
			'status',
			'attempt',
			'failureCode',
			'failureMessage',
			'exitCode',
			'bytesTransferred'
		]
	];
	for (const host of hosts) {
		const failure = isRecord(host.failure) ? host.failure : {};
		const result = isRecord(host.result) ? host.result : {};
		rows.push([
			String(model.id ?? ''),
			String(host.hostId ?? ''),
			String(host.hostName ?? ''),
			String(host.protocol ?? ''),
			String(host.status ?? ''),
			String(host.attempt ?? ''),
			String(failure.code ?? ''),
			String(failure.message ?? ''),
			String(result.exitCode ?? ''),
			String(result.bytesTransferred ?? '')
		]);
	}
	return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function sanitizeReportFields(
	fields: Record<string, string | number | boolean | null>,
	redactionValues: string[]
): Record<string, string | number | boolean | null> {
	const sanitized: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (secretKeyPattern.test(key)) continue;
		if (typeof value === 'string') sanitized[key] = redactText(value, redactionValues).text;
		else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
			sanitized[key] = value;
		}
	}
	return sanitized;
}

function csvCell(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function isExecutionFailure(value: unknown): value is BulkHostExecutionFailure {
	return isRecord(value) && ('code' in value || 'stdout' in value || 'stderr' in value);
}

function isBulkFailureCode(value: unknown): value is BulkFailureCode {
	return (
		value === 'access_denied' ||
		value === 'auth_failed' ||
		value === 'cancelled' ||
		value === 'command_failed' ||
		value === 'connection_failed' ||
		value === 'host_unreachable' ||
		value === 'not_retryable' ||
		value === 'runner_failed' ||
		value === 'timeout' ||
		value === 'transfer_failed' ||
		value === 'validation_failed'
	);
}

function isAbortMessage(message: string): boolean {
	return /abort|cancel/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
