import { createCipheriv, hkdfSync } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialService } from '$lib/server/services/credentials';
import { ServiceValidationError } from '$lib/server/services/errors';
import { HostService } from '$lib/server/services/hosts';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { CredentialCrypto, SecretCiphertext } from '$lib/server/services/types';
import { InMemoryImportJobRepository } from './import-jobs';
import { ImportService, parseImportUpload } from './service';

const crypto: CredentialCrypto = {
	encrypt(plaintext: string): SecretCiphertext {
		return {
			ciphertext: `encrypted:${plaintext}`,
			metadata: {
				algorithm: 'aes-256-gcm',
				keyVersion: 1,
				iv: 'iv',
				authTag: 'tag',
				salt: 'salt'
			}
		};
	},
	decrypt(secret: SecretCiphertext): string {
		return secret.ciphertext.replace(/^encrypted:/, '');
	}
};
const sourceSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const performanceIt = process.env.TERMIXKIT_PERFORMANCE_BUDGETS === '1' ? it : it.skip;

function createService(repository = new InMemoryTermixServicesRepository()) {
	const importJobs = new InMemoryImportJobRepository();
	return {
		importJobs,
		imports: new ImportService(
			importJobs,
			new HostService(repository),
			new CredentialService(repository, crypto)
		),
		repository
	};
}

class RejectingHostRepository extends InMemoryTermixServicesRepository {
	async createHost(
		host: Parameters<InMemoryTermixServicesRepository['createHost']>[0]
	): ReturnType<InMemoryTermixServicesRepository['createHost']> {
		if (host.name === 'Conflict SSH') {
			throw new ServiceValidationError(['host conflicts with an existing protected endpoint']);
		}
		return super.createHost(host);
	}
}

describe('ImportService', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('parses JSON arrays and object-wrapped connection exports', () => {
		expect(parseImportUpload({ fileName: 'termix.json', bytes: '[{"id":1}]' })).toMatchObject({
			sourceKind: 'json',
			records: [{ id: 1 }]
		});
		expect(
			parseImportUpload({
				fileName: 'termix.json',
				bytes: JSON.stringify({ connections: [{ name: 'Prod' }] })
			})
		).toMatchObject({
			records: [{ id: 'row-1', name: 'Prod' }]
		});
	});

	it('detects SQLite uploads before attempting JSON parsing', () => {
		expect(() =>
			parseImportUpload({ fileName: 'termix.sqlite', bytes: 'not a sqlite database' })
		).toThrow('SQLite file header is invalid');
	});

	it('rejects malformed and unsupported JSON payload shapes before mapping records', () => {
		expect(() => parseImportUpload({ fileName: 'empty.json', bytes: new Uint8Array() })).toThrow(
			'import file is empty'
		);
		expect(() => parseImportUpload({ fileName: 'broken.json', bytes: '{"records": [' })).toThrow(
			'import file is not valid JSON'
		);
		expect(() =>
			parseImportUpload({ fileName: 'settings.json', bytes: JSON.stringify({ settings: {} }) })
		).toThrow('import JSON must be an array or an object with records, connections, or hosts');
	});

	it('validates uploads into persisted import jobs without importing records', async () => {
		const { imports, repository } = createService();
		const result = await imports.validate('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify([
				{
					id: 'prod',
					name: 'Prod SSH',
					protocol: 'ssh',
					hostname: 'prod.example.test',
					password: 'secret'
				}
			])
		});

		expect(result.job.status).toBe('validated');
		expect(result.job.summary).toMatchObject({
			totalRecords: 1,
			validHosts: 1,
			validCredentials: 1,
			importedHosts: 0,
			importedCredentials: 0
		});
		expect(result.preview.credentials[0]).not.toHaveProperty('secret');
		await expect(repository.listHosts('user-1')).resolves.toHaveLength(0);
	});

	it('persists failed validation lifecycle state for malformed uploads', async () => {
		const { imports, importJobs } = createService();

		await expect(
			imports.validate('user-1', {
				fileName: 'termix.json',
				bytes: '{"records": ['
			})
		).rejects.toThrow('import file is not valid JSON');

		const [job] = await importJobs.listImportJobs('user-1');
		expect(job).toMatchObject({
			mode: 'validate',
			status: 'failed',
			sourceName: 'termix.json',
			summary: {
				totalRecords: 0,
				validHosts: 0,
				validCredentials: 0,
				importedHosts: 0,
				importedCredentials: 0,
				skippedRecords: 0,
				warnings: 0,
				failures: 1
			},
			failures: ['import file is not valid JSON']
		});
		expect(job?.finishedAt).toBeInstanceOf(Date);
	});

	it('redacts plaintext secrets from validation previews and import job records', async () => {
		const { imports } = createService();
		const result = await imports.validate('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify({
				records: [
					{
						id: 'prod',
						name: 'Prod SSH',
						protocol: 'ssh',
						hostname: 'prod.example.test',
						username: 'deploy',
						password: 'top-secret-password'
					}
				]
			})
		});

		expect(result.preview.credentials[0]).not.toHaveProperty('secret');
		expect(JSON.stringify(result.preview)).not.toContain('top-secret-password');
		expect(JSON.stringify(result.job)).not.toContain('top-secret-password');
	});

	it('imports validated records into host and credential services', async () => {
		const { imports, repository } = createService();
		const result = await imports.import('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify({
				records: [
					{
						id: 'prod',
						name: 'Prod SSH',
						protocol: 'ssh',
						hostname: 'prod.example.test',
						username: 'deploy',
						password: 'secret'
					}
				]
			})
		});

		const hosts = await repository.listHosts('user-1');
		const credentials = await repository.listCredentials('user-1');

		expect(result.job.status).toBe('completed');
		expect(result.job.summary).toMatchObject({
			importedHosts: 1,
			importedCredentials: 1,
			failures: 0
		});
		expect(hosts).toHaveLength(1);
		expect(credentials).toHaveLength(1);
		expect(hosts[0]?.credentialId).toBe(credentials[0]?.id);
	});

	it('deduplicates shared source credentials while importing duplicate host references', async () => {
		const { imports, repository } = createService();
		const result = await imports.import('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify({
				records: [
					{
						id: 'prod-a',
						credentialSourceId: 'shared-prod',
						credentialName: 'Shared prod password',
						name: 'Prod A',
						protocol: 'ssh',
						hostname: 'prod-a.example.test',
						username: 'deploy',
						password: 'shared-secret'
					},
					{
						id: 'prod-b',
						credentialSourceId: 'shared-prod',
						credentialName: 'Shared prod password',
						name: 'Prod B',
						protocol: 'ssh',
						hostname: 'prod-b.example.test',
						username: 'deploy',
						password: 'shared-secret'
					}
				]
			})
		});

		const hosts = await repository.listHosts('user-1');
		const credentials = await repository.listCredentials('user-1');

		expect(result.job.status).toBe('completed');
		expect(result.job.summary).toMatchObject({
			totalRecords: 2,
			validHosts: 2,
			validCredentials: 1,
			importedHosts: 2,
			importedCredentials: 1,
			failures: 0
		});
		expect(credentials).toHaveLength(1);
		expect(new Set(hosts.map((host) => host.credentialId))).toEqual(new Set([credentials[0]?.id]));
	});

	it('keeps successful imports and records completed_with_errors when one host conflicts', async () => {
		const repository = new RejectingHostRepository();
		const { imports } = createService(repository);

		const result = await imports.import('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify({
				records: [
					{
						id: 'ok',
						name: 'Working SSH',
						protocol: 'ssh',
						hostname: 'ok.example.test'
					},
					{
						id: 'conflict',
						name: 'Conflict SSH',
						protocol: 'ssh',
						hostname: 'conflict.example.test'
					}
				]
			})
		});

		await expect(repository.listHosts('user-1')).resolves.toMatchObject([
			{
				name: 'Working SSH',
				hostname: 'ok.example.test'
			}
		]);
		expect(result.job.status).toBe('completed_with_errors');
		expect(result.job.summary).toMatchObject({
			totalRecords: 2,
			validHosts: 2,
			importedHosts: 1,
			failures: 1
		});
		expect(result.job.failures).toEqual([
			'host conflict: host conflicts with an existing protected endpoint'
		]);
	});

	it('persists imported host metadata for protocol bootstrapping', async () => {
		const { imports, repository } = createService();
		const result = await imports.import('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify({
				records: [
					{
						id: 'rdp-prod',
						name: 'Windows admin',
						protocol: 'rdp',
						hostname: 'windows.example.test',
						username: 'admin',
						domain: 'ACME',
						sourceUserId: 'source-user-1',
						sourceUserEmail: 'owner@example.test'
					}
				]
			})
		});

		const [host] = await repository.listHosts('user-1');

		expect(result.job.status).toBe('completed');
		expect(host?.metadata).toEqual(
			expect.objectContaining({
				domain: 'ACME',
				sourceUserId: 'source-user-1',
				sourceUserEmail: 'owner@example.test'
			})
		);
	});

	it('surfaces top-level source account rows as import warnings', async () => {
		const { imports, repository } = createService();
		const result = await imports.validate('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify({
				hosts: [
					{
						id: 'prod',
						name: 'Prod SSH',
						protocol: 'ssh',
						hostname: 'prod.example.test'
					}
				],
				users: [
					{
						id: 'source-user-1',
						email: 'owner@example.test',
						password_hash: '$2b$10$legacy-termix-password-hash'
					},
					{
						id: 'source-user-2',
						email: 'viewer@example.test'
					}
				]
			})
		});

		expect(result.job.status).toBe('validated');
		expect(result.job.summary).toMatchObject({
			totalRecords: 3,
			validHosts: 1,
			warnings: 2
		});
		expect(result.job.warnings).toEqual([
			{
				sourceId: 'source-user-1',
				code: 'unsupported_user_account',
				message:
					'Source user accounts or password hashes were not imported; TermixKit imports hosts into the signed-in user and requires new local or Microsoft auth.'
			},
			{
				sourceId: 'source-user-2',
				code: 'unsupported_user_account',
				message:
					'Source user accounts or password hashes were not imported; TermixKit imports hosts into the signed-in user and requires new local or Microsoft auth.'
			}
		]);
		await expect(repository.listHosts('user-1')).resolves.toHaveLength(0);
	});

	it('uses sourceSecret during import so decryptable source credentials are stored', async () => {
		const { imports, repository } = createService();
		const encryptedPassword = encryptTermixField({
			plaintext: 'source-password',
			sourceSecret,
			recordId: 'prod',
			fieldName: 'password'
		});

		const result = await imports.import('user-1', {
			fileName: 'termix.json',
			sourceSecret,
			bytes: JSON.stringify({
				records: [
					{
						id: 'prod',
						name: 'Prod SSH',
						protocol: 'ssh',
						hostname: 'prod.example.test',
						username: 'deploy',
						password: JSON.stringify(encryptedPassword)
					}
				]
			})
		});

		const [credential] = await repository.listCredentials('user-1');

		expect(result.job.status).toBe('completed');
		expect(result.job.summary).toMatchObject({
			importedHosts: 1,
			importedCredentials: 1,
			warnings: 0
		});
		expect(credential?.encryptedSecret).toBe('encrypted:source-password');
	});

	it('falls back to the environment source secret for encrypted imports', async () => {
		const { imports, repository } = createService();
		vi.stubEnv('TERMIXKIT_IMPORT_SOURCE_SECRET', sourceSecret);
		const encryptedPassword = encryptTermixField({
			plaintext: 'env-source-password',
			sourceSecret,
			recordId: 'prod-env',
			fieldName: 'password'
		});

		const result = await imports.import('user-1', {
			fileName: 'termix.json',
			bytes: JSON.stringify({
				records: [
					{
						id: 'prod-env',
						name: 'Prod SSH',
						protocol: 'ssh',
						hostname: 'prod.example.test',
						username: 'deploy',
						password: JSON.stringify(encryptedPassword)
					}
				]
			})
		});

		const [credential] = await repository.listCredentials('user-1');

		expect(result.job.status).toBe('completed');
		expect(result.job.summary).toMatchObject({
			importedHosts: 1,
			importedCredentials: 1,
			warnings: 0
		});
		expect(credential?.encryptedSecret).toBe('encrypted:env-source-password');
	});

	performanceIt(
		'parses and validates a representative large JSON import within budget',
		async () => {
			const records = Array.from({ length: 600 }, (_, index) => ({
				id: `host-${index + 1}`,
				name: `Host ${index + 1}`,
				protocol: index % 5 === 0 ? 'sftp' : 'ssh',
				hostname: `host-${index + 1}.example.test`,
				port: 2200 + (index % 50),
				username: `user-${index % 7}`,
				password: `fixture-secret-${index + 1}`,
				tags: index % 2 === 0 ? 'prod, primary' : ['dev', 'secondary'],
				notes: 'Representative importer budget fixture'
			}));
			const upload = {
				fileName: 'large-termix.json',
				bytes: JSON.stringify({ records })
			};

			const parseStart = performance.now();
			const parsed = parseImportUpload(upload);
			const parseMs = performance.now() - parseStart;

			const { imports } = createService();
			const validateStart = performance.now();
			const result = await imports.validate('user-1', upload);
			const validateMs = performance.now() - validateStart;

			expect(parsed.records).toHaveLength(600);
			expect(result.job.summary).toMatchObject({
				totalRecords: 600,
				validHosts: 600,
				validCredentials: 600,
				warnings: 0,
				failures: 0
			});
			expect(parseMs).toBeLessThan(1_500);
			expect(validateMs).toBeLessThan(5_000);
		}
	);
});

function encryptTermixField(input: {
	plaintext: string;
	sourceSecret: string;
	recordId: string;
	fieldName: string;
}) {
	const salt = Buffer.from('11'.repeat(32), 'hex');
	const iv = Buffer.from('22'.repeat(16), 'hex');
	const key = Buffer.from(input.sourceSecret, 'hex');
	const fieldKey = Buffer.from(
		hkdfSync('sha256', key, salt, `${input.recordId}:${input.fieldName}`, 32)
	);
	const cipher = createCipheriv('aes-256-gcm', fieldKey, iv);
	const data = cipher.update(input.plaintext, 'utf8', 'hex') + cipher.final('hex');

	return {
		data,
		iv: iv.toString('hex'),
		tag: cipher.getAuthTag().toString('hex'),
		salt: salt.toString('hex'),
		recordId: input.recordId
	};
}
