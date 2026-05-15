import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SFTPWrapper } from 'ssh2';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { CredentialRecord, HostRecord } from '$lib/server/services/types';
import {
	createSftpDirectory,
	deleteSftpPath,
	listSftpDirectory,
	readSftpFile,
	renameSftpPath,
	resolveSftpTarget,
	validateSftpPath,
	writeSftpFile,
	writeSftpTextFile,
	type SftpTarget
} from './sftp';

const sshMocks = vi.hoisted(() => ({
	connectTrustedSsh: vi.fn()
}));

vi.mock('./ssh-connect', () => ({
	connectTrustedSsh: sshMocks.connectTrustedSsh
}));

beforeEach(() => {
	sshMocks.connectTrustedSsh.mockReset();
});

describe('SFTP path validation', () => {
	it('normalizes absolute remote paths', () => {
		expect(validateSftpPath('/srv/app//logs/')).toBe('/srv/app/logs');
		expect(validateSftpPath(' /srv/app/./logs/ ')).toBe('/srv/app/logs');
	});

	it('rejects relative and traversal paths', () => {
		expect(() => validateSftpPath('', 'remotePath')).toThrow(ServiceValidationError);
		expect(() => validateSftpPath('srv/app')).toThrow(ServiceValidationError);
		expect(() => validateSftpPath('/srv/../etc/passwd')).toThrow(ServiceValidationError);
	});

	it('rejects NUL bytes', () => {
		expect(() => validateSftpPath('/srv/app\0secret')).toThrow(ServiceValidationError);
	});

	it('does not allow deleting the remote filesystem root', async () => {
		await expect(
			deleteSftpPath(
				{ userId: 'user-1', hostId: 'host-1', host: 'example.test', port: 22, username: 'ops' },
				'/'
			)
		).rejects.toMatchObject({
			issues: ['path cannot be the filesystem root']
		});
	});
});

describe('SFTP target resolution', () => {
	it('resolves host username targets and preserves SSH jump host metadata', async () => {
		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(
			testHost({
				username: 'host-user',
				metadata: { sshJumpHost: { enabled: true, hostId: 'jump-1' } }
			})
		);

		await expect(resolveSftpTarget('user-1', 'host-1', repository)).resolves.toEqual({
			userId: 'user-1',
			hostId: 'host-1',
			host: 'shell.example.test',
			port: 22,
			username: 'host-user',
			credential: undefined,
			jumpHost: { hostId: 'jump-1' }
		});
	});

	it('decrypts saved password credentials with credential AAD context', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password'
		});
		await repository.createHost(testHost({ credentialId: credential.id, username: null }));

		const target = await resolveSftpTarget('user-1', 'host-1', repository, crypto);

		expect(credential.encryptedSecret).not.toBe('saved-password');
		expect(credential.encryption.associatedData).toEqual({ version: 1, field: 'secret' });
		expect(target).toEqual({
			userId: 'user-1',
			hostId: 'host-1',
			host: 'shell.example.test',
			port: 22,
			username: 'credential-user',
			credential: {
				kind: 'password',
				username: 'credential-user',
				password: 'saved-password'
			}
		});
	});

	it('decrypts saved SSH key passphrases with credential metadata AAD context', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'ssh_key',
			secret: 'private-key',
			metadata: { passphrase: 'key-passphrase' }
		});
		await repository.createHost(testHost({ credentialId: credential.id, username: 'host-user' }));

		const target = await resolveSftpTarget('user-1', 'host-1', repository, crypto);

		expect(credential.metadata.passphrase).toBeUndefined();
		expect(credential.metadata.encryptedPassphrase).toMatchObject({
			ciphertext: expect.any(String),
			encryption: expect.objectContaining({
				associatedData: { version: 1, field: 'metadata.passphrase' }
			})
		});
		expect(target).toEqual({
			userId: 'user-1',
			hostId: 'host-1',
			host: 'shell.example.test',
			port: 22,
			username: 'credential-user',
			credential: {
				kind: 'ssh_key',
				username: 'credential-user',
				privateKey: 'private-key',
				passphrase: 'key-passphrase'
			}
		});
	});

	it('rejects non-SSH hosts and targets without any username before connecting', async () => {
		const nonSsh = new InMemoryTermixServicesRepository();
		await nonSsh.createHost(testHost({ protocol: 'ftp', username: 'files-user' }));

		await expect(resolveSftpTarget('user-1', 'host-1', nonSsh)).rejects.toMatchObject({
			issues: ['SFTP is only available for SSH hosts']
		});

		const missingUsername = new InMemoryTermixServicesRepository();
		await missingUsername.createHost(testHost());

		await expect(resolveSftpTarget('user-1', 'host-1', missingUsername)).rejects.toMatchObject({
			issues: ['Host username or credential username is required']
		});
	});

	it('rejects hosts that reference missing credentials before connecting', async () => {
		const repository = new InMemoryTermixServicesRepository();
		await repository.createHost(testHost({ credentialId: 'missing-credential' }));

		await expect(resolveSftpTarget('user-1', 'host-1', repository)).rejects.toMatchObject({
			message: 'Credential not found'
		});
	});
});

describe('SFTP file operations', () => {
	it('lists directories with sorted normalized entries and closes the SSH connection', async () => {
		const sftp = new FakeSftp({
			entries: [
				sftpEntry('z.txt', 'file', { size: 12, mtime: 1_700_000_000, mode: 0o640 }),
				sftpEntry('current', 'symlink'),
				sftpEntry('app', 'directory')
			]
		});
		const connection = connectWithSftp(sftp);

		const entries = await listSftpDirectory(testTarget(), '/srv//app/');

		expect(sshMocks.connectTrustedSsh).toHaveBeenCalledWith(testTarget());
		expect(sftp.calls).toContain('readdir:/srv/app');
		expect(connection.ended).toBe(true);
		expect(entries).toEqual([
			expect.objectContaining({ name: 'app', path: '/srv/app/app', type: 'directory' }),
			expect.objectContaining({ name: 'current', path: '/srv/app/current', type: 'symlink' }),
			expect.objectContaining({
				name: 'z.txt',
				path: '/srv/app/z.txt',
				type: 'file',
				size: 12,
				mtime: '2023-11-14T22:13:20.000Z',
				mode: 0o640
			})
		]);
	});

	it('reads, writes, creates, and renames paths through the SFTP wrapper', async () => {
		const sftp = new FakeSftp({ files: new Map([['/srv/message.txt', Buffer.from('hello')]]) });
		const connection = connectWithSftp(sftp);

		await expect(readSftpFile(testTarget(), '/srv/message.txt')).resolves.toEqual(
			Buffer.from('hello')
		);
		await writeSftpTextFile(testTarget(), '/srv/out.txt', 'saved');
		await createSftpDirectory(testTarget(), '/srv/new');
		await renameSftpPath(testTarget(), '/srv/out.txt', '/srv/archive.txt');

		expect(sftp.files.get('/srv/out.txt')).toEqual(Buffer.from('saved'));
		expect(sftp.calls).toEqual([
			'readFile:/srv/message.txt',
			'writeFile:/srv/out.txt:saved',
			'mkdir:/srv/new',
			'rename:/srv/out.txt:/srv/archive.txt'
		]);
		expect(connection.ended).toBe(true);
		expect(sshMocks.connectTrustedSsh).toHaveBeenCalledTimes(4);
	});

	it('rejects oversized uploads before opening SSH or SFTP connections', async () => {
		await expect(
			writeSftpFile(testTarget(), '/srv/large.bin', Buffer.from('too-large'), 4)
		).rejects.toThrow(ServicePayloadTooLargeError);

		expect(sshMocks.connectTrustedSsh).not.toHaveBeenCalled();
	});

	it('chooses unlink or rmdir after stat and closes on operation failures', async () => {
		const sftp = new FakeSftp({
			stats: new Map([
				['/srv/file.txt', fakeAttrs('file')],
				['/srv/empty', fakeAttrs('directory')]
			])
		});
		connectWithSftp(sftp);

		await deleteSftpPath(testTarget(), '/srv/file.txt');
		await deleteSftpPath(testTarget(), '/srv/empty');

		expect(sftp.calls).toEqual([
			'stat:/srv/file.txt',
			'unlink:/srv/file.txt',
			'stat:/srv/empty',
			'rmdir:/srv/empty'
		]);

		const failing = new FakeSftp({ error: new Error('remote failure') });
		const failingConnection = connectWithSftp(failing);

		await expect(readSftpFile(testTarget(), '/srv/fail.txt')).rejects.toThrow('remote failure');
		expect(failingConnection.ended).toBe(true);
	});

	it('closes the SSH connection when opening the SFTP subsystem fails', async () => {
		const connection = connectWithSftp(new FakeSftp(), new Error('subsystem disabled'));

		await expect(listSftpDirectory(testTarget(), '/srv')).rejects.toThrow('subsystem disabled');
		expect(connection.ended).toBe(true);
	});

	it('propagates SSH host-key trust failures before opening the SFTP subsystem', async () => {
		const error = Object.assign(new Error('changed host key'), { name: 'SshHostKeyTrustError' });
		sshMocks.connectTrustedSsh.mockRejectedValue(error);

		await expect(listSftpDirectory(testTarget(), '/srv')).rejects.toMatchObject({
			name: 'SshHostKeyTrustError',
			message: 'changed host key'
		});
		expect(sshMocks.connectTrustedSsh).toHaveBeenCalledWith(testTarget());
	});
});

async function createEncryptedCredential(input: {
	kind: 'password' | 'ssh_key';
	secret: string;
	metadata?: Record<string, unknown>;
}): Promise<{
	repository: InMemoryTermixServicesRepository;
	crypto: AesGcmCredentialCrypto;
	credential: CredentialRecord;
}> {
	const repository = new InMemoryTermixServicesRepository();
	const crypto = new AesGcmCredentialCrypto('sftp-test-master-key');
	const service = new CredentialService(repository, crypto);
	const created = await service.create('user-1', {
		name: 'SFTP credential',
		kind: input.kind,
		username: 'credential-user',
		secret: input.secret,
		metadata: input.metadata
	});
	const credential = await repository.getCredential('user-1', created.id);

	if (!credential) throw new Error('test credential was not stored');
	return { repository, crypto, credential };
}

function testHost(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date();
	return {
		id: 'host-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'Shell',
		protocol: 'ssh',
		hostname: 'shell.example.test',
		port: 22,
		username: null,
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function testTarget(patch: Partial<SftpTarget> = {}): SftpTarget {
	return {
		userId: 'user-1',
		hostId: 'host-1',
		host: 'shell.example.test',
		port: 22,
		username: 'ops',
		...patch
	};
}

function connectWithSftp(sftp: FakeSftp, sftpError: Error | null = null): FakeSshConnection {
	const connection = new FakeSshConnection(sftp, sftpError);
	sshMocks.connectTrustedSsh.mockResolvedValue(connection);
	return connection;
}

function sftpEntry(
	filename: string,
	kind: 'directory' | 'file' | 'symlink' | 'other',
	patch: Partial<Pick<ReturnType<typeof fakeAttrs>, 'size' | 'mtime' | 'mode'>> = {}
) {
	return {
		filename,
		longname: filename,
		attrs: fakeAttrs(kind, patch)
	};
}

function fakeAttrs(
	kind: 'directory' | 'file' | 'symlink' | 'other',
	patch: Partial<{ size: number; mtime: number; mode: number }> = {}
) {
	return {
		size: patch.size ?? 0,
		mtime: patch.mtime ?? 0,
		mode: patch.mode ?? 0,
		isDirectory: () => kind === 'directory',
		isFile: () => kind === 'file',
		isSymbolicLink: () => kind === 'symlink'
	};
}

class FakeSshConnection {
	ended = false;

	constructor(
		private readonly sftpWrapper: FakeSftp,
		private readonly sftpError: Error | null
	) {}

	sftp(callback: (error: Error | undefined, sftp: SFTPWrapper | undefined) => void): void {
		callback(this.sftpError ?? undefined, this.sftpError ? undefined : (this.sftpWrapper as never));
	}

	end(): void {
		this.ended = true;
	}
}

class FakeSftp {
	calls: string[] = [];
	files: Map<string, Buffer>;
	private readonly entries: ReturnType<typeof sftpEntry>[];
	private readonly stats: Map<string, ReturnType<typeof fakeAttrs>>;
	private readonly error: Error | null;

	constructor({
		entries = [],
		files = new Map(),
		stats = new Map(),
		error = null
	}: {
		entries?: ReturnType<typeof sftpEntry>[];
		files?: Map<string, Buffer>;
		stats?: Map<string, ReturnType<typeof fakeAttrs>>;
		error?: Error | null;
	} = {}) {
		this.entries = entries;
		this.files = files;
		this.stats = stats;
		this.error = error;
	}

	readdir(path: string, callback: (error: Error | undefined, entries?: unknown[]) => void): void {
		this.calls.push(`readdir:${path}`);
		callback(this.error ?? undefined, this.entries);
	}

	readFile(path: string, callback: (error: Error | undefined, data?: Buffer) => void): void {
		this.calls.push(`readFile:${path}`);
		callback(this.error ?? undefined, this.files.get(path) ?? Buffer.alloc(0));
	}

	writeFile(path: string, data: Buffer, callback: (error: Error | undefined) => void): void {
		this.calls.push(`writeFile:${path}:${data.toString('utf8')}`);
		this.files.set(path, data);
		callback(this.error ?? undefined);
	}

	mkdir(path: string, callback: (error: Error | undefined) => void): void {
		this.calls.push(`mkdir:${path}`);
		callback(this.error ?? undefined);
	}

	rename(from: string, to: string, callback: (error: Error | undefined) => void): void {
		this.calls.push(`rename:${from}:${to}`);
		callback(this.error ?? undefined);
	}

	unlink(path: string, callback: (error: Error | undefined) => void): void {
		this.calls.push(`unlink:${path}`);
		callback(this.error ?? undefined);
	}

	rmdir(path: string, callback: (error: Error | undefined) => void): void {
		this.calls.push(`rmdir:${path}`);
		callback(this.error ?? undefined);
	}

	stat(
		path: string,
		callback: (error: Error | undefined, attrs?: ReturnType<typeof fakeAttrs>) => void
	): void {
		this.calls.push(`stat:${path}`);
		callback(this.error ?? undefined, this.stats.get(path) ?? fakeAttrs('file'));
	}
}
