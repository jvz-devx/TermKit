import { CredentialService } from '$lib/server/services/credentials';
import { ServiceNotFoundError, ServiceValidationError } from '$lib/server/services/errors';
import { HostService } from '$lib/server/services/hosts';
import {
	emptyImportJobSummary,
	importJobRepository,
	type ImportJobRecord,
	type ImportJobRepository,
	type ImportJobSummary,
	type ImportSourceKind
} from './import-jobs';
import {
	mapTermixRecords,
	type ImportedCredentialDto,
	type ImportedHostDto,
	type ImportMappingResult,
	type TermixSourceRecord
} from './termix';
import { isSqliteBuffer, parseTermixSqliteDatabase } from './sqlite';

export type ImportUploadInput = {
	fileName: string;
	contentType?: string;
	bytes: ArrayBuffer | Uint8Array | string;
	sourceSecret?: string;
};

export type ImportPreview = {
	hosts: ImportedHostDto[];
	credentials: Array<Omit<ImportedCredentialDto, 'secret'>>;
};

export type ImportOperationResult = {
	job: ImportJobRecord;
	preview: ImportPreview;
};

type ParsedImportSource = {
	sourceKind: ImportSourceKind;
	records: TermixSourceRecord[];
};

export class ImportService {
	constructor(
		private readonly jobs: ImportJobRepository = importJobRepository,
		private readonly hosts: HostService = new HostService(),
		private readonly credentials: CredentialService = new CredentialService()
	) {}

	listJobs(userId: string): Promise<ImportJobRecord[]> {
		return this.jobs.listImportJobs(userId);
	}

	async getJob(userId: string, id: string): Promise<ImportJobRecord> {
		const job = await this.jobs.getImportJob(userId, id);
		if (!job) throw new ServiceNotFoundError('Import job not found');
		return job;
	}

	async validate(userId: string, upload: ImportUploadInput): Promise<ImportOperationResult> {
		const job = await this.jobs.createImportJob({
			userId,
			mode: 'validate',
			sourceName: sourceName(upload.fileName)
		});

		try {
			await this.jobs.updateImportJob(userId, job.id, { status: 'validating' });
			const parsed = parseImportUpload(upload);
			const mapping = mapTermixRecords(parsed.records, {
				sourceSecret: upload.sourceSecret
			});
			const summary = summaryFromMapping(parsed.records.length, mapping);
			const updated = await this.jobs.updateImportJob(userId, job.id, {
				status: 'validated',
				sourceKind: parsed.sourceKind,
				summary,
				warnings: mapping.warnings,
				finishedAt: new Date()
			});

			return { job: updated ?? job, preview: previewFromMapping(mapping) };
		} catch (error) {
			return this.failJob(userId, job, error);
		}
	}

	async import(userId: string, upload: ImportUploadInput): Promise<ImportOperationResult> {
		const job = await this.jobs.createImportJob({
			userId,
			mode: 'import',
			sourceName: sourceName(upload.fileName)
		});

		try {
			await this.jobs.updateImportJob(userId, job.id, { status: 'importing' });
			const parsed = parseImportUpload(upload);
			const mapping = mapTermixRecords(parsed.records, {
				sourceSecret: upload.sourceSecret
			});
			const failures: string[] = [];
			const credentialIds = new Map<string, string>();
			let importedCredentials = 0;
			let importedHosts = 0;

			for (const credential of mapping.credentials) {
				try {
					const created = await this.credentials.create(userId, {
						name: credential.name,
						kind: credential.kind,
						username: credential.username,
						secret: credential.secret,
						metadata: {
							...credential.metadata,
							importJobId: job.id,
							sourceId: credential.sourceId
						}
					});
					credentialIds.set(credential.sourceId, created.id);
					importedCredentials += 1;
				} catch (error) {
					failures.push(formatFailure(`credential ${credential.sourceId}`, error));
				}
			}

			for (const host of mapping.hosts) {
				try {
					await this.hosts.create(userId, {
						name: host.name,
						protocol: host.protocol,
						hostname: host.hostname,
						port: host.port,
						username: host.username,
						credentialId: host.credentialRef ? credentialIds.get(host.credentialRef) : undefined,
						folder: host.folder,
						tags: host.tags,
						notes: host.notes
					});
					importedHosts += 1;
				} catch (error) {
					failures.push(formatFailure(`host ${host.sourceId}`, error));
				}
			}

			const baseSummary = summaryFromMapping(parsed.records.length, mapping);
			const summary = {
				...baseSummary,
				importedHosts,
				importedCredentials,
				failures: failures.length
			} satisfies ImportJobSummary;
			const updated = await this.jobs.updateImportJob(userId, job.id, {
				status: failures.length > 0 ? 'completed_with_errors' : 'completed',
				sourceKind: parsed.sourceKind,
				summary,
				warnings: mapping.warnings,
				failures,
				finishedAt: new Date()
			});

			return { job: updated ?? job, preview: previewFromMapping(mapping) };
		} catch (error) {
			return this.failJob(userId, job, error);
		}
	}

	private async failJob(
		userId: string,
		job: ImportJobRecord,
		error: unknown
	): Promise<ImportOperationResult> {
		const failures = [error instanceof Error ? error.message : 'Import failed'];
		await this.jobs.updateImportJob(userId, job.id, {
			status: 'failed',
			summary: { ...emptyImportJobSummary, failures: failures.length },
			failures,
			finishedAt: new Date()
		});

		throw error;
	}
}

export function parseImportUpload(upload: ImportUploadInput): ParsedImportSource {
	const bytes = uploadToBytes(upload.bytes);
	if (bytes.byteLength === 0) throw new ServiceValidationError(['import file is empty']);

	if (isSqliteFile(upload.fileName) || isSqliteBuffer(bytes)) {
		return {
			sourceKind: 'sqlite',
			records: parseTermixSqliteDatabase(bytes)
		};
	}

	const text = Buffer.from(bytes).toString('utf8').trim();
	if (!text) throw new ServiceValidationError(['import file is empty']);

	const parsed = parseJson(text);
	const rows = extractRecordArray(parsed);
	if (!rows) {
		throw new ServiceValidationError([
			'import JSON must be an array or an object with records, connections, or hosts'
		]);
	}

	return {
		sourceKind: 'json',
		records: rows.map(toTermixSourceRecord)
	};
}

function uploadToBytes(bytes: ImportUploadInput['bytes']): Uint8Array {
	if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
	if (bytes instanceof Uint8Array) return bytes;
	return new Uint8Array(bytes);
}

function isSqliteFile(fileName: string): boolean {
	return /\.(sqlite|sqlite3|db)$/i.test(fileName);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new ServiceValidationError(['import file is not valid JSON']);
	}
}

function extractRecordArray(parsed: unknown): unknown[] | null {
	if (Array.isArray(parsed)) return parsed;
	if (!isRecord(parsed)) return null;

	for (const key of ['records', 'connections', 'hosts']) {
		const value = parsed[key];
		if (Array.isArray(value)) return value;
	}

	return null;
}

function toTermixSourceRecord(value: unknown, index: number): TermixSourceRecord {
	if (!isRecord(value)) {
		return {
			id: `row-${index + 1}`,
			raw: { value }
		};
	}

	return {
		...value,
		id:
			typeof value.id === 'string' || typeof value.id === 'number' ? value.id : `row-${index + 1}`,
		raw: value
	} as TermixSourceRecord;
}

function summaryFromMapping(totalRecords: number, mapping: ImportMappingResult): ImportJobSummary {
	return {
		totalRecords,
		validHosts: mapping.hosts.length,
		validCredentials: mapping.credentials.length,
		importedHosts: 0,
		importedCredentials: 0,
		skippedRecords: mapping.summary.skippedRecords,
		warnings: mapping.warnings.length,
		failures: 0
	};
}

function previewFromMapping(mapping: ImportMappingResult): ImportPreview {
	return {
		hosts: mapping.hosts,
		credentials: mapping.credentials.map(({ secret: _secret, ...credential }) => credential)
	};
}

function sourceName(fileName: string): string {
	return fileName.trim() || 'upload';
}

function formatFailure(scope: string, error: unknown): string {
	if (error instanceof ServiceValidationError) return `${scope}: ${error.issues.join('; ')}`;
	if (error instanceof Error) return `${scope}: ${error.message}`;
	return `${scope}: failed`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const importService = new ImportService();
