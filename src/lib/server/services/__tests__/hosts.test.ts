import { describe, expect, it } from 'vitest';
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
});
