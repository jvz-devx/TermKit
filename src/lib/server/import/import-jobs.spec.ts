import { describe, expect, it } from 'vitest';
import type { TermixDb } from '$lib/server/db';
import {
	DrizzleImportJobRepository,
	emptyImportJobSummary,
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

describe('DrizzleImportJobRepository', () => {
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
});
