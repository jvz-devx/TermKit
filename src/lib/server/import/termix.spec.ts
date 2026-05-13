import { describe, expect, it } from 'vitest';
import { mapTermixRecords } from './termix';

describe('mapTermixRecords', () => {
	it('maps supported host fields and plaintext password credentials', () => {
		const result = mapTermixRecords([
			{
				id: 7,
				name: 'Prod shell',
				protocol: 'ssh',
				hostname: 'prod.example.test',
				port: '2222',
				username: 'deploy',
				password: 'plain-password',
				folder: 'Production',
				tags: 'linux, primary',
				notes: 'Main SSH endpoint'
			}
		]);

		expect(result.hosts).toEqual([
			{
				sourceId: '7',
				name: 'Prod shell',
				protocol: 'ssh',
				hostname: 'prod.example.test',
				port: 2222,
				username: 'deploy',
				credentialRef: '7:password',
				folder: 'Production',
				tags: ['linux', 'primary'],
				notes: 'Main SSH endpoint',
				metadata: {}
			}
		]);
		expect(result.credentials).toEqual([
			{
				sourceId: '7:password',
				name: 'Prod shell password',
				kind: 'password',
				username: 'deploy',
				secret: 'plain-password',
				metadata: { sourceRecordId: '7' }
			}
		]);
		expect(result.summary).toEqual({
			createdHosts: 1,
			createdCredentials: 1,
			skippedRecords: 0,
			warnings: 0
		});
	});

	it('normalizes SFTP records to SSH and maps SSH key credentials', () => {
		const result = mapTermixRecords([
			{
				id: 'keyed',
				label: 'SFTP drop',
				connectionType: 'sftp',
				address: 'files.example.test',
				user: 'backup',
				privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
				tags: ['files', 'backup'],
				domain: 'EXAMPLE'
			}
		]);

		expect(result.hosts[0]).toMatchObject({
			sourceId: 'keyed',
			name: 'SFTP drop',
			protocol: 'ssh',
			hostname: 'files.example.test',
			port: 22,
			username: 'backup',
			credentialRef: 'keyed:ssh-key',
			tags: ['files', 'backup'],
			metadata: { domain: 'EXAMPLE' }
		});
		expect(result.credentials[0]).toMatchObject({
			sourceId: 'keyed:ssh-key',
			kind: 'ssh_key',
			username: 'backup'
		});
		expect(result.warnings).toHaveLength(0);
	});

	it('skips unsupported records and records warnings for ignored data', () => {
		const result = mapTermixRecords([
			{
				id: 'ftp-1',
				protocol: 'ftp',
				hostname: 'legacy.example.test'
			},
			{
				id: 'rdp-1',
				protocol: 'rdp',
				host: 'win.example.test',
				password: 'encrypted:v1:ciphertext',
				guacamoleConfig: { width: 1920 },
				snippetId: 42,
				serverStats: { cpu: 1 }
			}
		]);

		expect(result.hosts).toHaveLength(1);
		expect(result.credentials).toHaveLength(0);
		expect(result.summary).toEqual({
			createdHosts: 1,
			createdCredentials: 0,
			skippedRecords: 1,
			warnings: 5
		});
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			'unsupported_protocol',
			'credential_requires_decryption',
			'unsupported_field',
			'unsupported_field',
			'unsupported_field'
		]);
	});

	it('skips records with missing hostname or invalid port', () => {
		const result = mapTermixRecords([
			{ id: 'missing-host', protocol: 'vnc' },
			{ id: 'bad-port', protocol: 'telnet', hostname: 'router.example.test', port: 70000 }
		]);

		expect(result.hosts).toHaveLength(0);
		expect(result.summary.skippedRecords).toBe(2);
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			'missing_hostname',
			'invalid_port'
		]);
	});
});
