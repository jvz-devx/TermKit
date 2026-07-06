import { describe, expect, it } from 'vitest';
import { AesGcmCredentialCrypto } from '../crypto';
import { credentialSecretContext } from '../credentials';
import { ServiceValidationError } from '../errors';
import { HostService } from '../hosts';
import { InMemoryTermixServicesRepository } from '../repository';

describe('HostService', () => {
	it('validates required host fields and port range', async () => {
		expect.assertions(4);

		const service = new HostService(new InMemoryTermixServicesRepository());

		await expect(
			service.create('user-1', {
				name: '',
				protocol: 'ssh',
				hostname: '',
				port: 70_000
			})
		).rejects.toBeInstanceOf(ServiceValidationError);

		await expect(
			service.create('user-1', {
				name: 'Prod SSH',
				protocol: 'smtp',
				hostname: 'prod.example.test',
				port: 22
			})
		).rejects.toMatchObject({
			issues: ['protocol must be ssh, rdp, vnc, telnet, ftp, or ftps']
		});

		const host = await service.create('user-1', {
			name: ' Prod SSH ',
			protocol: 'ssh',
			hostname: ' prod.example.test ',
			port: 22,
			tags: [' prod ', 'prod', '', 1]
		});

		expect(host).toMatchObject({
			userId: 'user-1',
			name: 'Prod SSH',
			protocol: 'ssh',
			hostname: 'prod.example.test',
			port: 22,
			tags: ['prod']
		});
		expect(host.id).toEqual(expect.any(String));
	});

	it('requires referenced credentials to belong to the host owner', async () => {
		expect.assertions(3);

		const repository = new InMemoryTermixServicesRepository();
		const service = new HostService(repository);
		const now = new Date('2026-05-13T12:00:00.000Z');
		await repository.createCredential({
			id: 'credential-1',
			userId: 'user-1',
			workspaceId: null,
			name: 'Prod password',
			kind: 'password',
			username: 'root',
			encryptedSecret: 'ciphertext',
			encryption: {
				algorithm: 'aes-256-gcm',
				keyVersion: 1,
				iv: 'iv',
				authTag: 'auth-tag',
				salt: 'salt'
			},
			metadata: {},
			createdAt: now,
			updatedAt: now
		});

		await expect(
			service.create('user-2', {
				name: 'Prod SSH',
				protocol: 'ssh',
				hostname: 'prod.example.test',
				port: 22,
				credentialId: 'credential-1'
			})
		).rejects.toMatchObject({
			issues: ['credentialId must reference an existing credential owned by the user']
		});

		const host = await service.create('user-1', {
			name: 'Prod SSH',
			protocol: 'ssh',
			hostname: 'prod.example.test',
			port: 22,
			credentialId: 'credential-1'
		});

		expect(host.credentialId).toBe('credential-1');
		await expect(
			service.update('user-1', host.id, { credentialId: 'missing' })
		).rejects.toMatchObject({
			issues: ['credentialId must reference an existing credential owned by the user']
		});
	});

	it('merges host metadata on update so imported and FTPS settings are preserved', async () => {
		const service = new HostService(new InMemoryTermixServicesRepository());
		const host = await service.create('user-1', {
			name: 'Imported FTPS',
			protocol: 'ftps',
			hostname: 'files.example.test',
			port: 21,
			metadata: {
				domain: 'CORP',
				source: { provider: 'microsoft', tenantId: 'tenant-1' },
				ftpsMode: 'implicit',
				ftps: {
					mode: 'implicit',
					rejectUnauthorized: false,
					certificateHostname: 'edge.example.test'
				}
			}
		});

		const updated = await service.update('user-1', host.id, {
			name: 'Renamed FTPS',
			metadata: {
				terminalPreferences: {
					scrollback: 10_000
				},
				ftps: {
					mode: 'explicit'
				}
			}
		});

		expect(updated.metadata).toMatchObject({
			domain: 'CORP',
			source: { provider: 'microsoft', tenantId: 'tenant-1' },
			ftpsMode: 'implicit',
			ftps: {
				mode: 'explicit',
				rejectUnauthorized: false,
				certificateHostname: 'edge.example.test'
			},
			terminalPreferences: {
				scrollback: 10_000
			}
		});
	});

	it('creates pending host shares and copies accepted hosts with optional credentials only', async () => {
		expect.assertions(10);

		const repository = new InMemoryTermixServicesRepository();
		const crypto = new AesGcmCredentialCrypto('test-master-key');
		const service = new HostService(repository, crypto);
		const now = new Date('2026-05-13T12:00:00.000Z');
		repository.createUser({ id: 'owner', username: 'owner', disabledAt: null });
		repository.createUser({ id: 'recipient', username: 'recipient', disabledAt: null }, [
			'recipient@example.test'
		]);
		const encrypted = crypto.encrypt('rdp-password', credentialSecretContext('owner', 'cred-1'));
		await repository.createCredential({
			id: 'cred-1',
			userId: 'owner',
			workspaceId: null,
			name: 'RDP password',
			kind: 'rdp_password',
			username: 'adminje',
			encryptedSecret: encrypted.ciphertext,
			encryption: encrypted.metadata,
			metadata: { domain: 'DOMAIN' },
			createdAt: now,
			updatedAt: now
		});
		const host = await service.create('owner', {
			name: 'SQL',
			protocol: 'rdp',
			hostname: 'sql.example.test',
			port: 3389,
			username: 'adminje',
			credentialId: 'cred-1',
			tags: ['db']
		});

		const [withoutCredentials] = await service.share('owner', {
			hostId: host.id,
			recipients: 'recipient@example.test',
			includeCredentials: false
		});
		expect(withoutCredentials).toMatchObject({
			recipientUserId: 'recipient',
			includeCredentials: false,
			credentialId: null,
			status: 'pending'
		});
		const copiedWithoutCredential = await service.acceptShare('recipient', withoutCredentials.id);
		expect(copiedWithoutCredential).toMatchObject({
			userId: 'recipient',
			name: 'SQL',
			hostname: 'sql.example.test',
			credentialId: null,
			workspaceId: null
		});

		const [withCredentials] = await service.share('owner', {
			hostId: host.id,
			recipients: ['recipient'],
			includeCredentials: true
		});
		expect(withCredentials.credentialName).toBe('RDP password');
		const copiedWithCredential = await service.acceptShare('recipient', withCredentials.id);
		expect(copiedWithCredential.credentialId).toEqual(expect.any(String));
		expect(copiedWithCredential.credentialId).not.toBe('cred-1');

		const copiedCredential = await repository.getCredential(
			'recipient',
			copiedWithCredential.credentialId!
		);
		expect(copiedCredential).toMatchObject({
			userId: 'recipient',
			name: 'RDP password',
			workspaceId: null,
			metadata: { domain: 'DOMAIN' }
		});
		expect(
			crypto.decrypt(
				{
					ciphertext: copiedCredential!.encryptedSecret,
					metadata: copiedCredential!.encryption
				},
				credentialSecretContext('recipient', copiedCredential!.id)
			)
		).toBe('rdp-password');
		await expect(service.listPendingShares('recipient')).resolves.toHaveLength(0);
		await expect(
			service.share('owner', { hostId: host.id, recipients: 'missing' })
		).rejects.toMatchObject({
			issues: ['user not found: missing']
		});
		await expect(
			service.share('recipient', { hostId: host.id, recipients: 'owner' })
		).rejects.toMatchObject({ name: 'ServiceNotFoundError' });
	});
});
