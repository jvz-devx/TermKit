import { randomUUID } from 'node:crypto';
import type { ImportWarning } from './termix';

export type ImportJobMode = 'validate' | 'import';
export type ImportJobStatus =
	| 'pending'
	| 'validating'
	| 'validated'
	| 'importing'
	| 'completed'
	| 'completed_with_errors'
	| 'failed';

export type ImportSourceKind = 'json' | 'sqlite' | 'unknown';

export type ImportJobSummary = {
	totalRecords: number;
	validHosts: number;
	validCredentials: number;
	importedHosts: number;
	importedCredentials: number;
	skippedRecords: number;
	warnings: number;
	failures: number;
};

export type ImportJobRecord = {
	id: string;
	userId: string;
	mode: ImportJobMode;
	status: ImportJobStatus;
	sourceName: string;
	sourceKind: ImportSourceKind;
	summary: ImportJobSummary;
	warnings: ImportWarning[];
	failures: string[];
	startedAt: Date;
	finishedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type ImportJobCreate = {
	userId: string;
	mode: ImportJobMode;
	sourceName: string;
	sourceKind?: ImportSourceKind;
};

export type ImportJobPatch = Partial<
	Pick<
		ImportJobRecord,
		'status' | 'sourceKind' | 'summary' | 'warnings' | 'failures' | 'finishedAt'
	>
>;

export interface ImportJobRepository {
	createImportJob(input: ImportJobCreate): Promise<ImportJobRecord>;
	updateImportJob(
		userId: string,
		id: string,
		patch: ImportJobPatch
	): Promise<ImportJobRecord | null>;
	getImportJob(userId: string, id: string): Promise<ImportJobRecord | null>;
	listImportJobs(userId: string): Promise<ImportJobRecord[]>;
}

export const emptyImportJobSummary = {
	totalRecords: 0,
	validHosts: 0,
	validCredentials: 0,
	importedHosts: 0,
	importedCredentials: 0,
	skippedRecords: 0,
	warnings: 0,
	failures: 0
} satisfies ImportJobSummary;

export class InMemoryImportJobRepository implements ImportJobRepository {
	private readonly jobs = new Map<string, ImportJobRecord>();

	async createImportJob(input: ImportJobCreate): Promise<ImportJobRecord> {
		const now = new Date();
		const job: ImportJobRecord = {
			id: randomUUID(),
			userId: input.userId,
			mode: input.mode,
			status: 'pending',
			sourceName: input.sourceName,
			sourceKind: input.sourceKind ?? 'unknown',
			summary: { ...emptyImportJobSummary },
			warnings: [],
			failures: [],
			startedAt: now,
			finishedAt: null,
			createdAt: now,
			updatedAt: now
		};

		this.jobs.set(job.id, job);
		return job;
	}

	async updateImportJob(
		userId: string,
		id: string,
		patch: ImportJobPatch
	): Promise<ImportJobRecord | null> {
		const job = await this.getImportJob(userId, id);
		if (!job) return null;

		const updated = {
			...job,
			...patch,
			id,
			userId,
			updatedAt: new Date()
		};
		this.jobs.set(id, updated);
		return updated;
	}

	async getImportJob(userId: string, id: string): Promise<ImportJobRecord | null> {
		const job = this.jobs.get(id);
		return job?.userId === userId ? job : null;
	}

	async listImportJobs(userId: string): Promise<ImportJobRecord[]> {
		return [...this.jobs.values()]
			.filter((job) => job.userId === userId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	}
}

export const importJobRepository = new InMemoryImportJobRepository();
