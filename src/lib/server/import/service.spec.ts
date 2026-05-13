import { describe, expect, it } from 'vitest';
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
			parseImportUpload({ fileName: 'termix.sqlite', bytes: 'SQLite format 3\u0000' })
		).toThrow('SQLite imports are detected but not parsed yet');
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
});
