import { describe, expect, it } from 'vitest';
import { ServiceValidationError } from '$lib/server/services/errors';
import { deleteSftpPath, validateSftpPath } from './sftp';

describe('SFTP path validation', () => {
	it('normalizes absolute remote paths', () => {
		expect(validateSftpPath('/srv/app//logs/')).toBe('/srv/app/logs');
	});

	it('rejects relative and traversal paths', () => {
		expect(() => validateSftpPath('srv/app')).toThrow(ServiceValidationError);
		expect(() => validateSftpPath('/srv/../etc/passwd')).toThrow(ServiceValidationError);
	});

	it('rejects NUL bytes', () => {
		expect(() => validateSftpPath('/srv/app\0secret')).toThrow(ServiceValidationError);
	});

	it('does not allow deleting the remote filesystem root', async () => {
		await expect(
			deleteSftpPath({ host: 'example.test', port: 22, username: 'ops' }, '/')
		).rejects.toMatchObject({
			issues: ['path cannot be the filesystem root']
		});
	});
});
