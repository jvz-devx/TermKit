import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TermixDb } from '$lib/server/db';
import {
	DrizzleImportJobRepository,
	emptyImportJobSummary,
	InMemoryImportJobRepository,
	importJobRepository
} from './import-jobs';

function fakeInsertDb<T>(rows: T[], capture: (values: unknown) => void): TermixDb {
	return {
		insert: () => ({
			values: (values: unknown) => {
				capture(values);
				return {
					returning: () => Promise.resolve(rows)
				};
			}
		})
	} as unknown as TermixDb;
}

function serializeQueryExpression(value: unknown): string {
	const seen = new WeakSet<object>();
	return (
		JSON.stringify(value, (_key, candidate) => {
			if (typeof candidate === 'bigint') return candidate.toString();
			if (typeof candidate === 'function') return `[function ${candidate.name}]`;
			if (typeof candidate === 'symbol') return candidate.toString();
			if (!candidate || typeof candidate !== 'object') return candidate;
			if (seen.has(candidate)) return '[Circular]';
			seen.add(candidate);
			return candidate;
		}) ?? ''
	);
}

describe('DrizzleImportJobRepository', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('is the production default import job repository', () => {
		expect.assertions(1);

		expect(importJobRepository).toBeInstanceOf(DrizzleImportJobRepository);
	});

	it('persists import job fields to the Drizzle import_jobs table', async () => {
		expect.assertions(3);

		const now = new Date('2026-05-13T12:00:00.000Z');
		let capturedValues: unknown;
		const repository = new DrizzleImportJobRepository(
			fakeInsertDb(
				[
					{
						id: 'job-1',
						userId: 'user-1',
						mode: 'import',
						status: 'pending',
						sourceName: 'termix.json',
						sourceKind: 'json',
						summary: { ...emptyImportJobSummary },
						warnings: [],
						failures: [],
						startedAt: now,
						finishedAt: null,
						createdAt: now,
						updatedAt: now
					}
				],
				(values) => {
					capturedValues = values;
				}
			)
		);

		const job = await repository.createImportJob({
			userId: 'user-1',
			mode: 'import',
			sourceName: 'termix.json',
			sourceKind: 'json'
		});

		expect(capturedValues).toMatchObject({
			userId: 'user-1',
			mode: 'import',
			status: 'pending',
			sourceName: 'termix.json',
			sourceKind: 'json',
			summary: emptyImportJobSummary,
			warnings: [],
			failures: []
		});
		expect(job).toMatchObject({
			id: 'job-1',
			userId: 'user-1',
			mode: 'import',
			status: 'pending',
			sourceName: 'termix.json',
			sourceKind: 'json'
		});
		expect(job.finishedAt).toBeNull();
	});

	it('updates import jobs through Drizzle with patch-only fields and timestamps', async () => {
		expect.assertions(6);

		const finishedAt = new Date('2026-05-13T12:10:00.000Z');
		const updatedAt = new Date('2026-05-13T12:11:00.000Z');
		const startedAt = new Date('2026-05-13T12:00:00.000Z');
		let capturedPatch: unknown;
		let capturedWhere: unknown;
		vi.useFakeTimers();
		vi.setSystemTime(updatedAt);
		const repository = new DrizzleImportJobRepository({
			update: () => ({
				set: (values: unknown) => {
					capturedPatch = values;
					return {
						where: (expression: unknown) => {
							capturedWhere = expression;
							return {
								returning: () =>
									Promise.resolve([
										{
											id: 'job-1',
											userId: 'user-1',
											mode: 'validate',
											status: 'failed',
											sourceName: 'termix.json',
											sourceKind: 'json',
											summary: { ...emptyImportJobSummary, failures: 1 },
											warnings: [],
											failures: ['import file is not valid JSON'],
											startedAt,
											finishedAt,
											createdAt: startedAt,
											updatedAt
										}
									])
							};
						}
					};
				}
			})
		} as unknown as TermixDb);

		const job = await repository.updateImportJob('user-1', 'job-1', {
			status: 'failed',
			sourceKind: 'json',
			summary: { ...emptyImportJobSummary, failures: 1 },
			failures: ['import file is not valid JSON'],
			finishedAt
		});

		const whereExpression = serializeQueryExpression(capturedWhere);
		expect(capturedPatch).toMatchObject({
			status: 'failed',
			sourceKind: 'json',
			summary: { ...emptyImportJobSummary, failures: 1 },
			failures: ['import file is not valid JSON'],
			finishedAt,
			updatedAt
		});
		expect(capturedPatch).not.toHaveProperty('userId');
		expect(capturedPatch).not.toHaveProperty('id');
		expect(whereExpression).toContain('job-1');
		expect(whereExpression).toContain('user-1');
		expect(job).toMatchObject({
			id: 'job-1',
			userId: 'user-1',
			status: 'failed',
			failures: ['import file is not valid JSON'],
			finishedAt
		});
	});

	it('lists import jobs through Drizzle newest first with JSON summaries mapped back intact', async () => {
		expect.assertions(4);

		const older = new Date('2026-05-13T12:00:00.000Z');
		const newer = new Date('2026-05-13T12:05:00.000Z');
		let capturedWhere: unknown;
		let capturedOrderBy: unknown;
		const repository = new DrizzleImportJobRepository({
			select: () => ({
				from: () => ({
					where: (expression: unknown) => {
						capturedWhere = expression;
						return {
							orderBy: (expression: unknown) => {
								capturedOrderBy = expression;
								return Promise.resolve([
									{
										id: 'new-job',
										userId: 'user-1',
										mode: 'import',
										status: 'completed',
										sourceName: 'new.json',
										sourceKind: 'json',
										summary: { ...emptyImportJobSummary, totalRecords: 2, importedHosts: 2 },
										warnings: [],
										failures: [],
										startedAt: newer,
										finishedAt: newer,
										createdAt: newer,
										updatedAt: newer
									},
									{
										id: 'old-job',
										userId: 'user-1',
										mode: 'validate',
										status: 'validated',
										sourceName: 'old.json',
										sourceKind: 'json',
										summary: { ...emptyImportJobSummary, totalRecords: 1, validHosts: 1 },
										warnings: [],
										failures: [],
										startedAt: older,
										finishedAt: older,
										createdAt: older,
										updatedAt: older
									}
								]);
							}
						};
					}
				})
			})
		} as unknown as TermixDb);

		await expect(repository.listImportJobs('user-1')).resolves.toMatchObject([
			{
				id: 'new-job',
				mode: 'import',
				summary: { totalRecords: 2, importedHosts: 2 }
			},
			{
				id: 'old-job',
				mode: 'validate',
				summary: { totalRecords: 1, validHosts: 1 }
			}
		]);
		const whereExpression = serializeQueryExpression(capturedWhere);
		expect(whereExpression).toContain('user-1');
		expect(serializeQueryExpression(capturedOrderBy)).toContain('created_at');
		expect(serializeQueryExpression(capturedOrderBy)).toContain('desc');
	});
});

describe('InMemoryImportJobRepository', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('isolates jobs by user and lists each user newest first', async () => {
		expect.assertions(6);

		const repository = new InMemoryImportJobRepository();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
		const first = await repository.createImportJob({
			userId: 'user-1',
			mode: 'validate',
			sourceName: 'first.json'
		});
		vi.setSystemTime(new Date('2026-05-13T12:01:00.000Z'));
		const second = await repository.createImportJob({
			userId: 'user-1',
			mode: 'import',
			sourceName: 'second.json'
		});
		await repository.createImportJob({
			userId: 'user-2',
			mode: 'import',
			sourceName: 'other.json'
		});

		expect(await repository.getImportJob('user-2', first.id)).toBeNull();
		expect(await repository.updateImportJob('user-2', first.id, { status: 'failed' })).toBeNull();
		await expect(repository.listImportJobs('user-1')).resolves.toMatchObject([
			{ id: second.id, sourceName: 'second.json' },
			{ id: first.id, sourceName: 'first.json' }
		]);

		const updated = await repository.updateImportJob('user-1', first.id, {
			status: 'validated',
			summary: { ...emptyImportJobSummary, totalRecords: 3, validHosts: 2 },
			warnings: [{ sourceId: 'skipped', code: 'missing_hostname', message: 'missing host' }]
		});

		expect(updated).toMatchObject({
			id: first.id,
			userId: 'user-1',
			status: 'validated',
			summary: { totalRecords: 3, validHosts: 2 },
			warnings: [{ sourceId: 'skipped', code: 'missing_hostname', message: 'missing host' }]
		});
		expect(updated?.updatedAt.getTime()).toBe(new Date('2026-05-13T12:01:00.000Z').getTime());
		expect(await repository.getImportJob('user-1', first.id)).toMatchObject({
			status: 'validated',
			summary: { totalRecords: 3, validHosts: 2 }
		});
	});
});
