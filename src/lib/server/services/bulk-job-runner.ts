import {
	BulkJobValidationError,
	cancelBulkJob,
	getRetryableBulkHostIds,
	markBulkHostCancelled,
	markBulkHostFailed,
	markBulkHostRunning,
	markBulkHostSucceeded,
	planBulkJob,
	queueRetryableBulkHosts,
	startBulkJob,
	type BulkHostExecutionResult,
	type BulkHostJob,
	type BulkHostTarget,
	type BulkJobPlanInput,
	type BulkJobRecord,
	type BulkSshCommandSpec,
	type BulkTransferSpec
} from '$lib/termix/bulk-jobs';
import { termixRepository } from './repository';
import type { HostRecord, HostRepository } from './types';

export type BulkJobHostRecord = Pick<
	HostRecord,
	'id' | 'name' | 'protocol' | 'hostname' | 'port' | 'username' | 'workspaceId'
>;

export type BulkJobHostResolver = {
	getHost(userId: string, hostId: string): Promise<BulkJobHostRecord | null>;
};

export type BulkJobRepository = {
	createJob(job: BulkJobRecord): Promise<BulkJobRecord>;
	getJob(userId: string, jobId: string): Promise<BulkJobRecord | null>;
	updateJob(userId: string, jobId: string, update: BulkJobRecord): Promise<BulkJobRecord | null>;
};

export type BulkJobExecutionContext = {
	job: BulkJobRecord;
	host: BulkHostJob;
	command?: BulkSshCommandSpec;
	transfer?: BulkTransferSpec;
	signal: AbortSignal;
};

export type BulkJobExecutors = {
	runSshCommand?(context: BulkJobExecutionContext): Promise<BulkHostExecutionResult>;
	runTransfer?(context: BulkJobExecutionContext): Promise<BulkHostExecutionResult>;
};

export type BulkJobRunnerOptions = {
	repository?: BulkJobRepository;
	hosts?: BulkJobHostResolver;
	executors?: BulkJobExecutors;
};

export class BulkJobRunner {
	private readonly repository: BulkJobRepository;
	private readonly hosts: BulkJobHostResolver;
	private readonly executors: BulkJobExecutors;
	private readonly controllers = new Map<string, AbortController>();
	private readonly updateQueues = new Map<string, Promise<void>>();

	constructor(options: BulkJobRunnerOptions = {}) {
		this.repository = options.repository ?? new InMemoryBulkJobRepository();
		this.hosts = options.hosts ?? new RepositoryBulkJobHostResolver();
		this.executors = options.executors ?? {};
	}

	async createJob(input: BulkJobPlanInput): Promise<BulkJobRecord> {
		const targets = await this.resolveTargets(
			input.userId,
			input.kind,
			input.targets,
			input.transfer
		);
		const job = planBulkJob({ ...input, targets });
		return this.repository.createJob(job);
	}

	getJob(userId: string, jobId: string): Promise<BulkJobRecord | null> {
		return this.repository.getJob(userId, jobId);
	}

	async run(userId: string, jobId: string): Promise<BulkJobRecord> {
		const existing = await this.requireJob(userId, jobId);
		if (existing.status === 'cancelled') return existing;

		const controller = new AbortController();
		this.controllers.set(existing.id, controller);
		let job = await this.save(startBulkJob(existing), userId);
		const queuedHosts = job.hosts.filter((host) => host.status === 'queued');
		let cursor = 0;

		const nextHost = (): BulkHostJob | null => queuedHosts[cursor++] ?? null;
		const workerCount = Math.min(job.concurrency.limit, queuedHosts.length);
		const workers = Array.from({ length: workerCount }, async () => {
			while (!controller.signal.aborted) {
				const host = nextHost();
				if (!host) return;
				job = await this.executeHost(userId, job.id, host, controller.signal);
			}
		});

		try {
			await Promise.all(workers);
		} finally {
			this.controllers.delete(existing.id);
		}

		if (controller.signal.aborted) {
			job = await this.save(cancelBulkJob(await this.requireJob(userId, jobId)), userId);
		}

		return this.requireJob(userId, job.id);
	}

	async cancel(userId: string, jobId: string): Promise<BulkJobRecord> {
		const job = await this.requireJob(userId, jobId);
		this.controllers.get(job.id)?.abort();
		return this.mutateJob(userId, jobId, (current) => cancelBulkJob(current));
	}

	async retryFailedHosts(userId: string, jobId: string): Promise<BulkJobRecord> {
		const job = await this.requireJob(userId, jobId);
		if (getRetryableBulkHostIds(job).length === 0) {
			throw new BulkJobValidationError(['No failed hosts are eligible for retry']);
		}
		await this.save(queueRetryableBulkHosts(job), userId);
		return this.run(userId, jobId);
	}

	private async executeHost(
		userId: string,
		jobId: string,
		host: BulkHostJob,
		signal: AbortSignal
	): Promise<BulkJobRecord> {
		let job = await this.mutateJob(userId, jobId, (current) =>
			markBulkHostRunning(current, host.hostId)
		);
		const activeHost = job.hosts.find((candidate) => candidate.hostId === host.hostId) ?? host;

		try {
			const result = await this.executeHostOperation(job, activeHost, signal);
			job = await this.mutateJob(userId, jobId, (current) =>
				markBulkHostSucceeded(current, host.hostId, result)
			);
		} catch (error) {
			if (signal.aborted || isAbortError(error)) {
				job = await this.mutateJob(userId, jobId, (current) =>
					markBulkHostCancelled(current, host.hostId)
				);
			} else {
				job = await this.mutateJob(userId, jobId, (current) =>
					markBulkHostFailed(current, host.hostId, error)
				);
			}
		}

		return job;
	}

	private executeHostOperation(
		job: BulkJobRecord,
		host: BulkHostJob,
		signal: AbortSignal
	): Promise<BulkHostExecutionResult> {
		if (job.kind === 'ssh_command') {
			if (!job.command) throw new BulkJobValidationError(['command is required']);
			if (!this.executors.runSshCommand) {
				throw {
					code: 'runner_failed',
					message:
						'No SSH command executor is configured; wire BulkJobExecutors.runSshCommand to the SSH execution service',
					retryable: false
				};
			}
			return runWithOptionalTimeout(
				(runSignal) =>
					this.executors.runSshCommand!({
						job,
						host,
						command: job.command!,
						signal: runSignal
					}),
				signal,
				job.command.timeoutMs ?? null
			);
		}

		if (!job.transfer) throw new BulkJobValidationError(['transfer is required']);
		if (!this.executors.runTransfer) {
			throw {
				code: 'runner_failed',
				message:
					'No transfer executor is configured; wire BulkJobExecutors.runTransfer to SFTP/FTP/FTPS services',
				retryable: false
			};
		}
		return this.executors.runTransfer({ job, host, transfer: job.transfer, signal });
	}

	private async resolveTargets(
		userId: string,
		kind: BulkJobPlanInput['kind'],
		targets: BulkHostTarget[],
		transfer?: BulkTransferSpec | null
	): Promise<BulkHostTarget[]> {
		const issues: string[] = [];
		const resolved = await Promise.all(
			targets.map(async (target, index) => {
				const hostId = typeof target.hostId === 'string' ? target.hostId.trim() : '';
				if (!hostId) {
					issues.push(`targets[${index}].hostId is required`);
					return target;
				}

				const host = await this.hosts.getHost(userId, hostId);
				if (!host) {
					issues.push(`host ${hostId} is not accessible to ${userId}`);
					return target;
				}

				const protocol = protocolForJob(kind, host, transfer);
				if (!protocol) {
					issues.push(protocolIssue(kind, host, transfer));
					return target;
				}

				return {
					hostId: host.id,
					hostName: host.name,
					protocol
				};
			})
		);

		if (issues.length > 0) throw new BulkJobValidationError(issues);
		return resolved;
	}

	private async requireJob(userId: string, jobId: string): Promise<BulkJobRecord> {
		const job = await this.repository.getJob(userId, jobId);
		if (!job) throw new BulkJobValidationError(['Bulk job not found']);
		return job;
	}

	private async save(job: BulkJobRecord, userId: string): Promise<BulkJobRecord> {
		const updated = await this.repository.updateJob(userId, job.id, job);
		if (!updated) throw new BulkJobValidationError(['Bulk job not found']);
		return updated;
	}

	private async mutateJob(
		userId: string,
		jobId: string,
		mutate: (job: BulkJobRecord) => BulkJobRecord
	): Promise<BulkJobRecord> {
		const previous = this.updateQueues.get(jobId) ?? Promise.resolve();
		let releaseCurrent!: () => void;
		const current = new Promise<void>((resolve) => {
			releaseCurrent = resolve;
		});
		const queued = previous.catch(() => undefined).then(() => current);
		this.updateQueues.set(jobId, queued);

		await previous.catch(() => undefined);
		try {
			const latest = await this.requireJob(userId, jobId);
			return await this.save(mutate(latest), userId);
		} finally {
			releaseCurrent();
			if (this.updateQueues.get(jobId) === queued) {
				this.updateQueues.delete(jobId);
			}
		}
	}
}

export class InMemoryBulkJobRepository implements BulkJobRepository {
	private readonly jobs = new Map<string, BulkJobRecord>();

	async createJob(job: BulkJobRecord): Promise<BulkJobRecord> {
		this.jobs.set(job.id, cloneJob(job));
		return cloneJob(job);
	}

	async getJob(userId: string, jobId: string): Promise<BulkJobRecord | null> {
		const job = this.jobs.get(jobId);
		return job?.userId === userId ? cloneJob(job) : null;
	}

	async updateJob(
		userId: string,
		jobId: string,
		update: BulkJobRecord
	): Promise<BulkJobRecord | null> {
		const existing = await this.getJob(userId, jobId);
		if (!existing) return null;
		const cloned = cloneJob(update);
		this.jobs.set(jobId, cloned);
		return cloneJob(cloned);
	}
}

export class RepositoryBulkJobHostResolver implements BulkJobHostResolver {
	constructor(private readonly repository: Pick<HostRepository, 'getHost'> = termixRepository) {}

	async getHost(userId: string, hostId: string): Promise<BulkJobHostRecord | null> {
		return this.repository.getHost(userId, hostId);
	}
}

export const bulkJobRunner = new BulkJobRunner();

function protocolForJob(
	kind: BulkJobPlanInput['kind'],
	host: BulkJobHostRecord,
	transfer?: BulkTransferSpec | null
): BulkHostTarget['protocol'] | null {
	if (kind === 'ssh_command') return host.protocol === 'ssh' ? 'ssh' : null;
	if (!transfer) return null;
	if (transfer.protocol === 'sftp') return host.protocol === 'ssh' ? 'sftp' : null;
	if (transfer.protocol === 'ftp') return host.protocol === 'ftp' ? 'ftp' : null;
	if (transfer.protocol === 'ftps') return host.protocol === 'ftps' ? 'ftps' : null;
	return null;
}

function protocolIssue(
	kind: BulkJobPlanInput['kind'],
	host: BulkJobHostRecord,
	transfer?: BulkTransferSpec | null
): string {
	if (kind === 'ssh_command') return `host ${host.id} must be an SSH host`;
	if (transfer?.protocol === 'sftp') return `host ${host.id} must be an SSH host for SFTP`;
	return `host ${host.id} must use ${transfer?.protocol ?? 'the requested transfer protocol'}`;
}

function runWithOptionalTimeout(
	work: (signal: AbortSignal) => Promise<BulkHostExecutionResult>,
	parentSignal: AbortSignal,
	timeoutMs: number | null
): Promise<BulkHostExecutionResult> {
	if (!timeoutMs) return work(parentSignal);

	const controller = new AbortController();
	const onAbort = () => controller.abort(parentSignal.reason);
	parentSignal.addEventListener('abort', onAbort, { once: true });

	const timeoutFailure = {
		code: 'timeout' as const,
		message: 'Bulk host operation timed out',
		retryable: true
	};
	let timedOut = false;
	let timeout!: ReturnType<typeof setTimeout>;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			timedOut = true;
			controller.abort(new Error('Bulk host operation timed out'));
			reject(timeoutFailure);
		}, timeoutMs);
	});

	const workPromise = work(controller.signal).catch((error) => {
		if ((timedOut || controller.signal.aborted) && !parentSignal.aborted) {
			throw timeoutFailure;
		}
		throw error;
	});

	return Promise.race([workPromise, timeoutPromise]).finally(() => {
		clearTimeout(timeout);
		parentSignal.removeEventListener('abort', onAbort);
	});
}

function isAbortError(error: unknown): boolean {
	if (error instanceof Error) return /abort|cancel/i.test(`${error.name} ${error.message}`);
	if (typeof error === 'object' && error !== null) {
		const value = error as { name?: unknown; message?: unknown; code?: unknown };
		return (
			value.code === 'cancelled' ||
			(typeof value.name === 'string' && /abort|cancel/i.test(value.name)) ||
			(typeof value.message === 'string' && /abort|cancel/i.test(value.message))
		);
	}
	return false;
}

function cloneJob(job: BulkJobRecord): BulkJobRecord {
	return {
		...job,
		reviewedHostIds: [...job.reviewedHostIds],
		hosts: job.hosts.map((host) => ({
			...host,
			failure: host.failure ? { ...host.failure, at: new Date(host.failure.at) } : null,
			result: host.result
				? {
						...host.result,
						stdout: { ...host.result.stdout },
						stderr: { ...host.result.stderr },
						report: host.result.report ? { ...host.result.report } : undefined
					}
				: null,
			startedAt: host.startedAt ? new Date(host.startedAt) : null,
			finishedAt: host.finishedAt ? new Date(host.finishedAt) : null
		})),
		concurrency: {
			...job.concurrency,
			waves: job.concurrency.waves.map((wave) => [...wave])
		},
		command: job.command
			? {
					...job.command,
					env: { ...(job.command.env ?? {}) }
				}
			: null,
		transfer: job.transfer ? { ...job.transfer } : null,
		retry: {
			maxAttempts: job.retry.maxAttempts,
			retryableCodes: [...job.retry.retryableCodes]
		},
		output: {
			maxBytes: job.output.maxBytes,
			redactionValues: [...job.output.redactionValues]
		},
		createdAt: new Date(job.createdAt),
		updatedAt: new Date(job.updatedAt),
		startedAt: job.startedAt ? new Date(job.startedAt) : null,
		finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
		cancelledAt: job.cancelledAt ? new Date(job.cancelledAt) : null
	};
}
