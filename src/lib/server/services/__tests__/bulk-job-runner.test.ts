import { describe, expect, it, vi } from 'vitest';
import { BulkJobValidationError, buildBulkJobReport } from '$lib/termix/bulk-jobs';
import {
	BulkJobRunner,
	InMemoryBulkJobRepository,
	type BulkJobExecutionContext,
	type BulkJobHostRecord,
	type BulkJobHostResolver
} from '../bulk-job-runner';

class StaticHostResolver implements BulkJobHostResolver {
	constructor(private readonly hosts: BulkJobHostRecord[]) {}

	async getHost(_userId: string, hostId: string): Promise<BulkJobHostRecord | null> {
		return this.hosts.find((host) => host.id === hostId) ?? null;
	}
}

describe('BulkJobRunner', () => {
	it('runs controlled SSH command jobs with bounded concurrency and partial failure reporting', async () => {
		expect.assertions(11);

		const activity: string[] = [];
		let active = 0;
		let maxActive = 0;
		const runner = new BulkJobRunner({
			repository: new InMemoryBulkJobRepository(),
			hosts: new StaticHostResolver([
				host('host-1', 'ssh'),
				host('host-2', 'ssh'),
				host('host-3', 'ssh')
			]),
			executors: {
				async runSshCommand(context) {
					active += 1;
					maxActive = Math.max(maxActive, active);
					activity.push(`start:${context.host.hostId}`);
					await Promise.resolve();
					active -= 1;
					if (context.host.hostId === 'host-2') {
						throw {
							code: 'command_failed',
							message: 'exit 42',
							retryable: false,
							stderr: 'password=secret-value',
							exitCode: 42
						};
					}
					return {
						exitCode: 0,
						stdout: `ok ${context.host.hostId} token=abc123`,
						stderr: ''
					};
				}
			}
		});

		const created = await runner.createJob({
			id: 'job-ssh',
			userId: 'user-1',
			kind: 'ssh_command',
			targets: [{ hostId: 'host-1' }, { hostId: 'host-2' }, { hostId: 'host-3' }],
			reviewedHostIds: ['host-1', 'host-2', 'host-3'],
			concurrencyLimit: 2,
			command: { command: 'uptime' },
			output: { redactionValues: ['abc123', 'secret-value'] }
		});
		const finished = await runner.run('user-1', created.id);

		expect(finished.status).toBe('partial_failed');
		expect(finished.concurrency.limit).toBe(2);
		expect(maxActive).toBeLessThanOrEqual(2);
		expect(activity).toEqual(['start:host-1', 'start:host-2', 'start:host-3']);
		expect(finished.hosts.map((item) => item.status)).toEqual(['succeeded', 'failed', 'succeeded']);
		expect(finished.hosts[1].failure).toMatchObject({
			code: 'command_failed',
			retryable: false
		});
		expect(finished.hosts[0].result?.stdout.text).not.toContain('abc123');
		expect(finished.hosts[1].result?.stderr.text).not.toContain('secret-value');

		const report = buildBulkJobReport(finished);
		expect(report.body).not.toContain('abc123');
		expect(report.body).not.toContain('secret-value');
		expect(report.body).toContain('partial_failed');
	});

	it('plans large fan-outs in stable waves and enforces the runtime concurrency budget', async () => {
		expect.assertions(8);

		const hostIds = Array.from({ length: 64 }, (_, index) => `host-${index + 1}`);
		const activity: string[] = [];
		let active = 0;
		let maxActive = 0;
		const runner = new BulkJobRunner({
			repository: new InMemoryBulkJobRepository(),
			hosts: new StaticHostResolver(hostIds.map((id) => host(id, 'ssh'))),
			executors: {
				async runSshCommand(context) {
					active += 1;
					maxActive = Math.max(maxActive, active);
					activity.push(context.host.hostId);
					await Promise.resolve();
					active -= 1;
					return { stdout: `ok ${context.host.hostId}` };
				}
			}
		});

		const created = await runner.createJob({
			id: 'job-large-fanout',
			userId: 'user-1',
			kind: 'ssh_command',
			targets: hostIds.map((hostId) => ({ hostId })),
			reviewedHostIds: hostIds,
			concurrencyLimit: 7,
			command: { command: 'uptime' }
		});
		const finished = await runner.run('user-1', created.id);

		expect(created.concurrency).toMatchObject({
			limit: 7,
			totalHosts: 64,
			waveCount: 10
		});
		expect(created.concurrency.waves[0]).toEqual(hostIds.slice(0, 7));
		expect(created.concurrency.waves[8]).toEqual(hostIds.slice(56, 63));
		expect(created.concurrency.waves[9]).toEqual(['host-64']);
		expect(maxActive).toBeLessThanOrEqual(7);
		expect(activity).toHaveLength(64);
		expect(finished.hosts.every((item) => item.status === 'succeeded')).toBe(true);
		expect(finished.status).toBe('completed');
	});

	it('cancels queued and running host work', async () => {
		expect.assertions(6);

		const seenSignals: AbortSignal[] = [];
		let startedFirst: (() => void) | null = null;
		const firstStarted = new Promise<void>((resolve) => {
			startedFirst = resolve;
		});
		const runner = new BulkJobRunner({
			repository: new InMemoryBulkJobRepository(),
			hosts: new StaticHostResolver([host('host-1', 'ssh'), host('host-2', 'ssh')]),
			executors: {
				async runSshCommand(context) {
					seenSignals.push(context.signal);
					startedFirst?.();
					await waitForAbort(context.signal);
					return { stdout: 'should not finish' };
				}
			}
		});
		const created = await runner.createJob({
			id: 'job-cancel',
			userId: 'user-1',
			kind: 'ssh_command',
			targets: [{ hostId: 'host-1' }, { hostId: 'host-2' }],
			reviewedHostIds: ['host-1', 'host-2'],
			concurrencyLimit: 1,
			command: { command: 'sleep 30' }
		});

		const running = runner.run('user-1', created.id);
		await firstStarted;
		const cancelled = await runner.cancel('user-1', created.id);
		const finished = await running;

		expect(seenSignals[0]?.aborted).toBe(true);
		expect(cancelled.status).toBe('cancelled');
		expect(finished.status).toBe('cancelled');
		expect(finished.hosts.map((item) => item.status)).toEqual(['cancelled', 'cancelled']);
		expect(finished.cancelledAt).toBeInstanceOf(Date);
		expect(finished.hosts.every((item) => item.failure?.code === 'cancelled')).toBe(true);
	});

	it('keeps cancellation races redacted when an executor resolves after abort', async () => {
		expect.assertions(5);

		let started: (() => void) | null = null;
		let releaseFirstHost!: () => void;
		const firstStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const releaseFirst = new Promise<void>((resolve) => {
			releaseFirstHost = resolve;
		});
		const runner = new BulkJobRunner({
			repository: new InMemoryBulkJobRepository(),
			hosts: new StaticHostResolver([host('host-1', 'ssh'), host('host-2', 'ssh')]),
			executors: {
				async runSshCommand(context) {
					started?.();
					await releaseFirst;
					return {
						stdout: `late output ${context.host.hostId} token=abc123`,
						report: { token: 'abc123', host: context.host.hostId }
					};
				}
			}
		});
		const created = await runner.createJob({
			id: 'job-cancel-race',
			userId: 'user-1',
			kind: 'ssh_command',
			targets: [{ hostId: 'host-1' }, { hostId: 'host-2' }],
			reviewedHostIds: ['host-1', 'host-2'],
			concurrencyLimit: 1,
			command: { command: 'slow-command' },
			output: { redactionValues: ['abc123'] }
		});

		const running = runner.run('user-1', created.id);
		await firstStarted;
		const cancelling = await runner.cancel('user-1', created.id);
		releaseFirstHost();
		const finished = await running;
		const report = buildBulkJobReport(finished);

		expect(cancelling.status).toBe('cancelled');
		expect(finished.status).toBe('cancelled');
		expect(finished.hosts[1]).toMatchObject({ status: 'cancelled' });
		expect(report.body).not.toContain('abc123');
		expect(JSON.stringify(finished.hosts[0].result)).not.toContain('abc123');
	});

	it('keeps in-memory job records cloned and scoped to their owner', async () => {
		expect.assertions(5);

		const repository = new InMemoryBulkJobRepository();
		const runner = new BulkJobRunner({
			repository,
			hosts: new StaticHostResolver([host('host-1', 'ssh')])
		});
		const created = await runner.createJob({
			id: 'job-owned',
			userId: 'user-1',
			kind: 'ssh_command',
			targets: [{ hostId: 'host-1' }],
			reviewedHostIds: ['host-1'],
			command: { command: 'uptime', env: { SAFE_ENV: '1' } }
		});
		const fetched = await repository.getJob('user-1', created.id);
		fetched?.hosts.push({
			...fetched.hosts[0],
			hostId: 'injected-host',
			status: 'succeeded'
		});
		if (fetched?.command?.env) fetched.command.env.SAFE_ENV = 'mutated';

		await expect(repository.getJob('user-2', created.id)).resolves.toBeNull();
		await expect(repository.updateJob('user-2', created.id, created)).resolves.toBeNull();
		const persisted = await repository.getJob('user-1', created.id);
		expect(persisted?.hosts.map((item) => item.hostId)).toEqual(['host-1']);
		expect(persisted?.command?.env).toEqual({ SAFE_ENV: '1' });
		expect(persisted).not.toBe(created);
	});

	it('retries only eligible failed hosts', async () => {
		expect.assertions(6);

		const attempts = new Map<string, number>();
		const runner = new BulkJobRunner({
			repository: new InMemoryBulkJobRepository(),
			hosts: new StaticHostResolver([host('host-1', 'ssh'), host('host-2', 'ssh')]),
			executors: {
				async runSshCommand(context) {
					const attempt = (attempts.get(context.host.hostId) ?? 0) + 1;
					attempts.set(context.host.hostId, attempt);
					if (context.host.hostId === 'host-2' && attempt === 1) {
						throw {
							code: 'connection_failed',
							message: 'temporary network failure',
							retryable: true
						};
					}
					return { stdout: `ok attempt ${attempt}` };
				}
			}
		});
		const created = await runner.createJob({
			id: 'job-retry',
			userId: 'user-1',
			kind: 'ssh_command',
			targets: [{ hostId: 'host-1' }, { hostId: 'host-2' }],
			reviewedHostIds: ['host-1', 'host-2'],
			command: { command: 'true' },
			retry: { maxAttempts: 2, retryableCodes: ['connection_failed'] }
		});

		const firstRun = await runner.run('user-1', created.id);
		const secondRun = await runner.retryFailedHosts('user-1', created.id);

		expect(firstRun.status).toBe('partial_failed');
		expect(firstRun.hosts.map((item) => item.status)).toEqual(['succeeded', 'failed']);
		expect(secondRun.status).toBe('completed');
		expect(secondRun.hosts.map((item) => item.status)).toEqual(['succeeded', 'succeeded']);
		expect(attempts.get('host-1')).toBe(1);
		expect(attempts.get('host-2')).toBe(2);
	});

	it('marks timed-out hosts retryable and preserves retry reporting', async () => {
		expect.assertions(7);

		vi.useFakeTimers();
		try {
			const attempts = new Map<string, number>();
			const runner = new BulkJobRunner({
				repository: new InMemoryBulkJobRepository(),
				hosts: new StaticHostResolver([host('host-1', 'ssh')]),
				executors: {
					async runSshCommand(context) {
						const attempt = (attempts.get(context.host.hostId) ?? 0) + 1;
						attempts.set(context.host.hostId, attempt);
						if (attempt === 1) {
							await waitForAbort(context.signal);
						}
						return {
							exitCode: 0,
							stdout: `retry ok ${attempt}`,
							report: { attempt }
						};
					}
				}
			});
			const created = await runner.createJob({
				id: 'job-timeout',
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [{ hostId: 'host-1' }],
				reviewedHostIds: ['host-1'],
				command: { command: 'sleep 10', timeoutMs: 1_000 },
				retry: { maxAttempts: 2, retryableCodes: ['timeout'] }
			});

			const firstRunPromise = runner.run('user-1', created.id);
			await vi.advanceTimersByTimeAsync(1_001);
			const firstRun = await firstRunPromise;
			const secondRun = await runner.retryFailedHosts('user-1', created.id);
			const report = buildBulkJobReport(secondRun);

			expect(firstRun.status).toBe('failed');
			expect(firstRun.hosts[0]).toMatchObject({
				status: 'failed',
				attempt: 1,
				failure: {
					code: 'timeout',
					message: 'Bulk host operation timed out',
					retryable: true
				}
			});
			expect(secondRun.status).toBe('completed');
			expect(secondRun.hosts[0]).toMatchObject({
				status: 'succeeded',
				attempt: 2,
				result: { report: { attempt: 2 } }
			});
			expect(attempts.get('host-1')).toBe(2);
			expect(report.body).toContain('completed');
			expect(secondRun.hosts[0].result?.stdout.text).toContain('retry ok 2');
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps late executor success from winning after a timeout abort', async () => {
		expect.assertions(5);

		vi.useFakeTimers();
		try {
			let releaseLateSuccess!: () => void;
			let sawAbort = false;
			const lateSuccess = new Promise<void>((resolve) => {
				releaseLateSuccess = resolve;
			});
			const runner = new BulkJobRunner({
				repository: new InMemoryBulkJobRepository(),
				hosts: new StaticHostResolver([host('host-1', 'ssh')]),
				executors: {
					async runSshCommand(context) {
						context.signal.addEventListener(
							'abort',
							() => {
								sawAbort = true;
							},
							{ once: true }
						);
						await waitForAbort(context.signal).catch(() => undefined);
						await lateSuccess;
						return { stdout: 'late success should not be persisted' };
					}
				}
			});
			const created = await runner.createJob({
				id: 'job-timeout-late-success',
				userId: 'user-1',
				kind: 'ssh_command',
				targets: [{ hostId: 'host-1' }],
				reviewedHostIds: ['host-1'],
				command: { command: 'sleep 10', timeoutMs: 1_000 }
			});

			const running = runner.run('user-1', created.id);
			await vi.advanceTimersByTimeAsync(1_001);
			const timedOut = await running;
			releaseLateSuccess();
			await Promise.resolve();
			const persisted = await runner.getJob('user-1', created.id);

			expect(sawAbort).toBe(true);
			expect(timedOut.status).toBe('failed');
			expect(timedOut.hosts[0].failure?.code).toBe('timeout');
			expect(timedOut.hosts[0].result?.stdout.text).not.toContain('late success');
			expect(persisted?.hosts[0].failure?.code).toBe('timeout');
		} finally {
			vi.useRealTimers();
		}
	});

	it('maps SFTP through SSH hosts and leaves transfer execution injectable', async () => {
		expect.assertions(5);

		const transferContexts: BulkJobExecutionContext[] = [];
		const runner = new BulkJobRunner({
			repository: new InMemoryBulkJobRepository(),
			hosts: new StaticHostResolver([host('ssh-host', 'ssh'), host('ftp-host', 'ftp')]),
			executors: {
				async runTransfer(context) {
					transferContexts.push(context);
					return {
						bytesTransferred: 1200,
						stdout: 'downloaded',
						report: { path: context.transfer?.remotePath ?? null, password: 'hidden' }
					};
				}
			}
		});

		await expect(
			runner.createJob({
				id: 'job-wrong-transfer-host',
				userId: 'user-1',
				kind: 'transfer',
				targets: [{ hostId: 'ftp-host' }],
				reviewedHostIds: ['ftp-host'],
				transfer: {
					protocol: 'sftp',
					action: 'download',
					remotePath: '/tmp/file.txt',
					destinationPath: 'artifact:file.txt'
				}
			})
		).rejects.toBeInstanceOf(BulkJobValidationError);

		const created = await runner.createJob({
			id: 'job-transfer',
			userId: 'user-1',
			kind: 'transfer',
			targets: [{ hostId: 'ssh-host' }],
			reviewedHostIds: ['ssh-host'],
			transfer: {
				protocol: 'sftp',
				action: 'download',
				remotePath: '/tmp/file.txt',
				destinationPath: 'artifact:file.txt'
			}
		});
		const finished = await runner.run('user-1', created.id);

		expect(transferContexts[0]?.host.protocol).toBe('sftp');
		expect(finished.status).toBe('completed');
		expect(finished.hosts[0].result?.bytesTransferred).toBe(1200);
		expect(finished.hosts[0].result?.report).toEqual({ path: '/tmp/file.txt' });
	});
});

function host(id: string, protocol: BulkJobHostRecord['protocol']): BulkJobHostRecord {
	return {
		id,
		name: id,
		protocol,
		hostname: `${id}.example.test`,
		port: protocol === 'ssh' ? 22 : 21,
		username: 'ops',
		workspaceId: null
	};
}

function waitForAbort(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(new Error('aborted'));
			return;
		}
		signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
	});
}
