import { redactText } from './bulk-job-output';
import type { BulkCapturedOutput, BulkJobRecord, BulkHostStatus } from './bulk-jobs';

export type BulkJobSummary = {
	total: number;
	succeeded: number;
	failed: number;
	cancelled: number;
	queued: number;
	running: number;
	partialFailure: boolean;
};

export function summarizeBulkJobHosts(hosts: { status: BulkHostStatus }[]): BulkJobSummary {
	const count = (status: BulkHostStatus) => hosts.filter((host) => host.status === status).length;
	const failed = count('failed');
	const cancelled = count('cancelled');
	const succeeded = count('succeeded');
	return {
		total: hosts.length,
		succeeded,
		failed,
		cancelled,
		queued: count('queued'),
		running: count('running'),
		partialFailure: succeeded > 0 && failed + cancelled > 0
	};
}

export function formatBulkJobReport(
	job: BulkJobRecord,
	summary: BulkJobSummary,
	format: 'json' | 'csv' = 'json'
): { filename: string; mimeType: string; body: string } {
	const safe = toReportModel(job, summary);
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

function toReportModel(job: BulkJobRecord, summary: BulkJobSummary): Record<string, unknown> {
	return {
		id: job.id,
		userId: job.userId,
		kind: job.kind,
		status: job.status,
		summary,
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

function csvCell(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
