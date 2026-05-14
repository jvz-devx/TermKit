import { createCipheriv, hkdfSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialService } from '$lib/server/services/credentials';
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

function createService() {
	const repository = new InMemoryTermixServicesRepository();
	return {
		imports: new ImportService(
			new InMemoryImportJobRepository(),
			new HostService(repository),
			new CredentialService(repository, crypto)
		),
		repository
	};
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
