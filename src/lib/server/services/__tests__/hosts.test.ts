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
				protocol: 'ftp',
				hostname: 'prod.example.test',
				port: 22
			})
		).rejects.toMatchObject({
			issues: ['protocol must be ssh, rdp, vnc, or telnet']
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
});
