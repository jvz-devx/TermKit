import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
	BulkJobValidationError,
	buildBulkJobReport,
	captureBulkOutput,
	getRetryableBulkHostIds,
	markBulkHostFailed,
	markBulkHostSucceeded,
	planBulkJob,
	queueRetryableBulkHosts,
	startBulkJob
} from './bulk-jobs';

const performanceIt = process.env.TERMKIT_PERFORMANCE_BUDGETS === '1' ? it : it.skip;

describe('bulk job domain', () => {
	it('requires an explicit reviewed host set and plans concurrency waves', () => {
		expect.assertions(5);

		expect(() =>
			planBulkJob({
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [
					{ hostId: 'host-1', protocol: 'ssh' },
					{ hostId: 'host-2', protocol: 'ssh' }
				],
				reviewedHostIds: ['host-1'],
				command: { command: 'uptime' }
			})
		).toThrow(BulkJobValidationError);

		expect(() =>
			planBulkJob({
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [{ hostId: 'host-1', protocol: 'ssh' }],
				reviewedHostIds: ['host-1', 'host-2'],
				command: { command: 'uptime' }
			})
		).toThrow(BulkJobValidationError);

		const job = planBulkJob({
			id: 'job-1',
			userId: 'user-1',
			kind: 'ssh_command',
			targets: [
				{ hostId: 'host-1', protocol: 'ssh' },
				{ hostId: 'host-2', protocol: 'ssh' },
				{ hostId: 'host-3', protocol: 'ssh' }
			],
			reviewedHostIds: ['host-1', 'host-2', 'host-3'],
			concurrencyLimit: 2,
			command: { command: 'uptime' }
		});

		expect(job.concurrency).toMatchObject({ limit: 2, totalHosts: 3, waveCount: 2 });
		expect(job.concurrency.waves).toEqual([['host-1', 'host-2'], ['host-3']]);
		expect(job.hosts.map((host) => host.status)).toEqual(['queued', 'queued', 'queued']);
	});

	it('validates controlled SSH commands and transfer protocols', () => {
		expect.assertions(3);

		expect(() =>
			planBulkJob({
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [{ hostId: 'host-1', protocol: 'ftp' }],
				reviewedHostIds: ['host-1'],
				command: { command: 'echo ok' }
			})
		).toThrow('host host-1 must use ssh for SSH command jobs');

		expect(() =>
			planBulkJob({
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [{ hostId: 'host-1', protocol: 'ssh' }],
				reviewedHostIds: ['host-1'],
				command: {
					command: 'deploy',
					env: { PASSWORD: 'super-secret' }
				}
			})
		).toThrow('command.env.PASSWORD cannot contain secret-like values');

		expect(() =>
			planBulkJob({
				userId: 'user-1',
				kind: 'transfer',
				targets: [{ hostId: 'host-1', protocol: 'ftp' }],
				reviewedHostIds: ['host-1'],
				transfer: {
					protocol: 'sftp',
					action: 'download',
					remotePath: '/var/log/app.log',
					destinationPath: 'reports/app.log'
				}
			})
		).toThrow('host host-1 must use sftp for this transfer job');
	});

	it('tracks partial failures and retry eligibility per host', () => {
		expect.assertions(6);

		const planned = startBulkJob(
			planBulkJob({
				id: 'job-2',
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [
					{ hostId: 'host-1', protocol: 'ssh' },
					{ hostId: 'host-2', protocol: 'ssh' }
				],
				reviewedHostIds: ['host-1', 'host-2'],
				command: { command: 'systemctl status app' },
				retry: { maxAttempts: 2, retryableCodes: ['connection_failed'] }
			})
		);
		const succeeded = markBulkHostSucceeded(planned, 'host-1', { stdout: 'ok' });
		const failed = markBulkHostFailed(succeeded, 'host-2', {
			code: 'connection_failed',
			message: 'temporary network failure',
			retryable: true,
			stderr: 'ssh: connect failed'
		});

		expect(failed.status).toBe('partial_failed');
		expect(failed.hosts[0].status).toBe('succeeded');
		expect(failed.hosts[1].status).toBe('failed');
		expect(failed.hosts[1].failure).toMatchObject({
			code: 'connection_failed',
			retryable: true
		});
		expect(getRetryableBulkHostIds(failed)).toEqual(['host-2']);
		expect(queueRetryableBulkHosts(failed).hosts[1]).toMatchObject({
			status: 'queued',
			attempt: 0,
			failure: null
		});
	});

	it('bounds and redacts output and report content', () => {
		expect.assertions(9);

		const output = captureBulkOutput('token=abc123\n' + 'x'.repeat(1200), {
			maxBytes: 1024,
			redactionValues: ['abc123']
		});

		expect(output.text).not.toContain('abc123');
		expect(output.text).toContain('token=[REDACTED]');
		expect(output.truncated).toBe(true);
		expect(output.originalBytes).toBeGreaterThan(1024);

		const job = markBulkHostSucceeded(
			startBulkJob(
				planBulkJob({
					id: 'job-3',
					userId: 'user-1',
					kind: 'ssh_command',
					targets: [{ hostId: 'host-1', hostName: 'Prod', protocol: 'ssh' }],
					reviewedHostIds: ['host-1'],
					command: { command: 'deploy --token abc123' },
					output: { maxBytes: 2048, redactionValues: ['abc123'] }
				})
			),
			'host-1',
			{
				stdout: 'password=hunter2',
				stderr: '',
				report: { artifact: 'release.tar', secret: 'do-not-emit' }
			}
		);
		const report = buildBulkJobReport(job);

		expect(report.mimeType).toBe('application/json');
		expect(report.body).not.toContain('abc123');
		expect(report.body).not.toContain('hunter2');
		expect(report.body).not.toContain('do-not-emit');
		expect(report.body).not.toContain('"text"');
	});

	it('redacts secret-like host report values in JSON and CSV exports', () => {
		expect.assertions(8);

		const job = markBulkHostFailed(
			startBulkJob(
				planBulkJob({
					id: 'job-4',
					userId: 'user-1',
					kind: 'ssh_command',
					targets: [{ hostId: 'host-1', hostName: 'Prod', protocol: 'ssh' }],
					reviewedHostIds: ['host-1'],
					command: { command: 'deploy --token abc123' },
					output: { maxBytes: 2048, redactionValues: ['abc123', 'hunter2'] },
					retry: { maxAttempts: 1, retryableCodes: [] }
				})
			),
			'host-1',
			{
				code: 'command_failed',
				message: 'deploy failed with Bearer abc123',
				retryable: false,
				stderr: 'password=hunter2',
				report: {
					notes: 'password=hunter2 token=abc123',
					authHeader: 'Bearer abc123',
					privateKey: 'should-drop-by-key',
					status: 'failed'
				}
			}
		);

		const jsonReport = buildBulkJobReport(job, 'json');
		const csvReport = buildBulkJobReport(job, 'csv');

		expect(jsonReport.body).not.toContain('hunter2');
		expect(jsonReport.body).not.toContain('abc123');
		expect(jsonReport.body).not.toContain('should-drop-by-key');
		expect(jsonReport.body).toContain('"notes": "password=[REDACTED] token=[REDACTED]"');
		expect(jsonReport.body).toContain('"authHeader": "Bearer [REDACTED]"');
		expect(jsonReport.body).toContain('"status": "failed"');
		expect(csvReport.body).not.toContain('abc123');
		expect(csvReport.body).toContain('Bearer [REDACTED]');
	});

	performanceIt(
		'keeps large fan-out wave planning deterministic and inside a coarse budget',
		() => {
			const targets = Array.from({ length: 251 }, (_, index) => ({
				hostId: `host-${String(index).padStart(3, '0')}`,
				protocol: 'ssh'
			}));
			const reviewedHostIds = targets.map((target) => target.hostId);

			const startedAt = performance.now();
			const job = planBulkJob({
				id: 'job-large-fanout',
				userId: 'user-1',
				kind: 'ssh_command',
				targets,
				reviewedHostIds,
				concurrencyLimit: 25,
				command: { command: 'uname -a' }
			});
			const elapsedMs = performance.now() - startedAt;

			expect(job.concurrency).toMatchObject({
				limit: 25,
				totalHosts: 251,
				waveCount: 11
			});
			expect(job.concurrency.waves[0]).toEqual(reviewedHostIds.slice(0, 25));
			expect(job.concurrency.waves.at(-1)).toEqual(['host-250']);
			expect(job.hosts.map((host) => host.hostId)).toEqual(reviewedHostIds);
			expect(elapsedMs).toBeLessThan(250);
		}
	);

	it('rejects fan-out concurrency above the guarded limit', () => {
		expect(() =>
			planBulkJob({
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [{ hostId: 'host-1', protocol: 'ssh' }],
				reviewedHostIds: ['host-1'],
				concurrencyLimit: 26,
				command: { command: 'uptime' }
			})
		).toThrow('concurrencyLimit must be an integer between 1 and 25');
	});
});
