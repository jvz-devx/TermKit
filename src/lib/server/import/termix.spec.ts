import { createCipheriv, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapTermixRecords } from './termix';

const sourceSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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

	it('preserves source user metadata and warns for unsupported V1 source data', () => {
		const result = mapTermixRecords([
			{
				id: 'owned',
				protocol: 'ssh',
				hostname: 'owned.example.test',
				ownerId: 42,
				ownerEmail: 'owner@example.test',
				docker: false,
				rbac: { role: 'admin' },
				raw: {
					dashboard_id: 'dashboard-1',
					docker_settings: { socket: '/var/run/docker.sock' },
					ssh_tunnels: [{ localPort: 15432 }],
					shared_with: ['team-1'],
					audit_logs: [{ action: 'created' }]
				}
			}
		]);

		expect(result.hosts[0]?.metadata).toEqual({
			sourceUserId: '42',
			sourceUserEmail: 'owner@example.test'
		});
		expect(result.warnings.map((warning) => warning.message)).toEqual([
			'Dashboard data was ignored.',
			'Docker integration settings were ignored.',
			'SSH tunnel settings were ignored.',
			'RBAC records were ignored.',
			'Sharing records were ignored.',
			'Audit records were ignored.'
		]);
	});

	it('does not warn for disabled unsupported source data flags', () => {
		const result = mapTermixRecords([
			{
				id: 'disabled-unsupported',
				protocol: 'ssh',
				hostname: 'plain.example.test',
				docker: false,
				sharing: false,
				rbac: false,
				raw: {
					ssh_tunnel: false,
					audit_logs: []
				}
			}
		]);

		expect(result.hosts).toHaveLength(1);
		expect(result.warnings).toHaveLength(0);
	});

	it('decrypts supported Termix field-crypto password fields with a source secret', () => {
		const encryptedPassword = encryptTermixField({
			plaintext: 'decrypted-password',
			sourceSecret,
			recordId: 'rdp-1',
			fieldName: 'password'
		});

		const result = mapTermixRecords(
			[
				{
					id: 'rdp-1',
					name: 'Windows',
					protocol: 'rdp',
					hostname: 'win.example.test',
					username: 'admin',
					password: JSON.stringify(encryptedPassword)
				}
			],
			{ sourceSecret }
		);

		expect(result.credentials).toEqual([
			{
				sourceId: 'rdp-1:password',
				name: 'Windows password',
				kind: 'password',
				username: 'admin',
				secret: 'decrypted-password',
				metadata: { sourceRecordId: 'rdp-1' }
			}
		]);
		expect(result.hosts[0]?.credentialRef).toBe('rdp-1:password');
		expect(result.warnings).toHaveLength(0);
	});

	it('maps Termix export ip aliases and decrypts encrypted key fields', () => {
		const encryptedKey = encryptTermixField({
			plaintext: '-----BEGIN OPENSSH PRIVATE KEY-----',
			sourceSecret,
			recordId: 'ssh-1',
			fieldName: 'key'
		});

		const result = mapTermixRecords(
			[
				{
					id: 'ssh-1',
					name: 'Exported SSH',
					connectionType: 'ssh',
					ip: '10.0.0.10',
					username: 'deploy',
					key: encryptedKey
				}
			],
			{ sourceSecret }
		);

		expect(result.hosts[0]).toMatchObject({
			sourceId: 'ssh-1',
			hostname: '10.0.0.10',
			credentialRef: 'ssh-1:ssh-key'
		});
		expect(result.credentials[0]).toMatchObject({
			sourceId: 'ssh-1:ssh-key',
			kind: 'ssh_key',
			secret: '-----BEGIN OPENSSH PRIVATE KEY-----'
		});
		expect(result.warnings).toHaveLength(0);
	});

	it('warns explicitly when encrypted credentials are unsupported or fail decryption', () => {
		const encryptedPassword = encryptTermixField({
			plaintext: 'decrypted-password',
			sourceSecret,
			recordId: 'rdp-1',
			fieldName: 'password'
		});

		const result = mapTermixRecords(
			[
				{
					id: 'legacy',
					protocol: 'ssh',
					hostname: 'legacy.example.test',
					password: 'encrypted:v1:ciphertext'
				},
				{
					id: 'rdp-1',
					protocol: 'rdp',
					hostname: 'win.example.test',
					password: JSON.stringify(encryptedPassword)
				}
			],
			{ sourceSecret: 'wrong-secret' }
		);

		expect(result.credentials).toHaveLength(0);
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			'unsupported_encrypted_credential',
			'credential_decryption_failed'
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
