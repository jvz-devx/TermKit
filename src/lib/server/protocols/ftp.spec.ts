import { Writable, type Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FileInfo, FileType, type AccessOptions } from 'basic-ftp';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { CredentialRecord, HostRecord } from '$lib/server/services/types';
import {
	createFtpDirectory,
	deleteFtpPath,
	listFtpDirectory,
	readFtpFile,
	renameFtpPath,
	resolveFtpTarget,
	validateFtpPath,
	writeFtpFile,
	type FtpClientLike,
	type FtpTarget
} from './ftp';

describe('FTP path validation', () => {
	it('normalizes absolute remote paths', () => {
		expect(validateFtpPath('/srv/app//logs/')).toBe('/srv/app/logs');
	});

	it('rejects relative and traversal paths', () => {
		expect(() => validateFtpPath('srv/app')).toThrow(ServiceValidationError);
		expect(() => validateFtpPath('/srv/../etc/passwd')).toThrow(ServiceValidationError);
	});

	it('rejects NUL bytes', () => {
		expect(() => validateFtpPath('/srv/app\0secret')).toThrow(ServiceValidationError);
	});

	it('does not allow deleting the remote filesystem root', async () => {
		await expect(deleteFtpPath(testTarget(), '/', () => new FakeFtpClient())).rejects.toMatchObject(
			{
				issues: ['path cannot be the filesystem root']
			}
		);
	});
});

describe('FTP target resolution', () => {
	it('decrypts saved password credentials for plain FTP hosts', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password'
		});
		await repository.createHost(testHost({ credentialId: credential.id, protocol: 'ftp' }));

		const target = await resolveFtpTarget('user-1', 'host-1', repository, crypto);

		expect(credential.encryptedSecret).not.toBe('saved-password');
		expect(target).toEqual({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ftp',
			host: 'files.example.test',
			port: 21,
			username: 'credential-user',
			password: 'saved-password',
			secure: false
		});
	});

	it('uses explicit FTPS by default and supports metadata-selected implicit FTPS', async () => {
		const explicit = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password'
		});
		await explicit.repository.createHost(
			testHost({ credentialId: explicit.credential.id, protocol: 'ftps' })
		);

		await expect(
			resolveFtpTarget('user-1', 'host-1', explicit.repository, explicit.crypto)
		).resolves.toMatchObject({ protocol: 'ftps', secure: true });

		const implicit = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password'
		});
		await implicit.repository.createHost(
			testHost({
				credentialId: implicit.credential.id,
				protocol: 'ftps',
				metadata: { ftpsMode: 'implicit' }
			})
		);

		await expect(
			resolveFtpTarget('user-1', 'host-1', implicit.repository, implicit.crypto)
		).resolves.toMatchObject({ protocol: 'ftps', secure: 'implicit' });
	});

	it('rejects SSH key credentials', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'ssh_key',
			secret: 'private-key'
		});
		await repository.createHost(testHost({ credentialId: credential.id, protocol: 'ftp' }));

		await expect(resolveFtpTarget('user-1', 'host-1', repository, crypto)).rejects.toMatchObject({
			issues: ['FTP/FTPS does not support SSH key credentials']
		});
	});
});

describe('FTP file operations', () => {
	it('lists directories with normalized entries and explicit FTPS access options', async () => {
		const client = new FakeFtpClient([
			fileInfo('z.txt', FileType.File, { size: 12, modifiedAt: new Date('2026-05-14T10:00:00Z') }),
			fileInfo('app', FileType.Directory)
		]);

		const entries = await listFtpDirectory(testTarget({ secure: true }), '/srv', () => client);

		expect(client.accessOptions).toMatchObject({
			host: 'files.example.test',
			port: 21,
			user: 'ops',
			password: 'secret',
			secure: true,
			secureOptions: { servername: 'files.example.test' }
		});
		expect(client.closed).toBe(true);
		expect(entries).toEqual([
			expect.objectContaining({ name: 'app', path: '/srv/app', type: 'directory' }),
			expect.objectContaining({
				name: 'z.txt',
				path: '/srv/z.txt',
				type: 'file',
				size: 12,
				mtime: '2026-05-14T10:00:00.000Z'
			})
		]);
	});

	it('downloads and uploads buffers server-side', async () => {
		const client = new FakeFtpClient();
		client.downloadData = Buffer.from('hello');

		await expect(readFtpFile(testTarget(), '/tmp/message.txt', () => client)).resolves.toEqual(
			Buffer.from('hello')
		);
		await writeFtpFile(testTarget(), '/tmp/out.txt', Buffer.from('saved'), () => client);

		expect(client.downloadedPath).toBe('/tmp/message.txt');
		expect(client.uploadedPath).toBe('/tmp/out.txt');
		expect(client.uploadedData).toEqual(Buffer.from('saved'));
	});

	it('rejects oversized downloads before buffering unbounded data', async () => {
		const client = new FakeFtpClient();
		client.downloadData = Buffer.from('too-large');

		await expect(readFtpFile(testTarget(), '/tmp/large.bin', () => client, 4)).rejects.toThrow(
			ServicePayloadTooLargeError
		);
		expect(client.closed).toBe(true);
	});

	it('creates, renames, and deletes paths', async () => {
		const client = new FakeFtpClient([
			fileInfo('old.txt', FileType.File),
			fileInfo('empty', FileType.Directory)
		]);

		await createFtpDirectory(testTarget(), '/var/new', () => client);
		await renameFtpPath(testTarget(), '/var/old.txt', '/var/new.txt', () => client);
		await deleteFtpPath(testTarget(), '/var/old.txt', () => client);
		await deleteFtpPath(testTarget(), '/var/empty', () => client);

		expect(client.createdDirectory).toBe('/var/new');
		expect(client.renamed).toEqual({ from: '/var/old.txt', to: '/var/new.txt' });
		expect(client.removedPath).toBe('/var/old.txt');
		expect(client.removedDirectory).toBe('/var/empty');
	});
});

async function createEncryptedCredential(input: {
	kind: 'password' | 'ssh_key';
	secret: string;
}): Promise<{
	repository: InMemoryTermixServicesRepository;
	crypto: AesGcmCredentialCrypto;
	credential: CredentialRecord;
}> {
	const repository = new InMemoryTermixServicesRepository();
	const crypto = new AesGcmCredentialCrypto('ftp-test-master-key');
	const service = new CredentialService(repository, crypto);
	const created = await service.create('user-1', {
		name: 'FTP credential',
		kind: input.kind,
		username: 'credential-user',
		secret: input.secret
	});
	const credential = await repository.getCredential('user-1', created.id);

	if (!credential) throw new Error('test credential was not stored');
	return { repository, crypto, credential };
}

function testHost(patch: Partial<HostRecord> & { protocol?: string } = {}): HostRecord {
	const now = new Date();
	return {
		id: 'host-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'Files',
		protocol: 'ftp',
		hostname: 'files.example.test',
		port: 21,
		username: null,
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	} as HostRecord;
}

function testTarget(patch: Partial<FtpTarget> = {}): FtpTarget {
	return {
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ftp',
		host: 'files.example.test',
		port: 21,
		username: 'ops',
		password: 'secret',
		secure: false,
		...patch
	};
}

function fileInfo(
	name: string,
	type: FileType,
	patch: Partial<Pick<FileInfo, 'size' | 'modifiedAt' | 'rawModifiedAt'>> = {}
): FileInfo {
	const entry = new FileInfo(name);
	entry.type = type;
	entry.size = patch.size ?? 0;
	entry.modifiedAt = patch.modifiedAt;
	entry.rawModifiedAt = patch.rawModifiedAt ?? '';
	return entry;
}

class FakeFtpClient implements FtpClientLike {
	accessOptions: AccessOptions | null = null;
	closed = false;
	downloadData = Buffer.alloc(0);
	downloadedPath: string | null = null;
	uploadedPath: string | null = null;
	uploadedData = Buffer.alloc(0);
	createdDirectory: string | null = null;
	renamed: { from: string; to: string } | null = null;
	removedPath: string | null = null;
	removedDirectory: string | null = null;

	constructor(private readonly entries: FileInfo[] = []) {}

	async access(options: AccessOptions): Promise<void> {
		this.accessOptions = options;
	}

	async list(): Promise<FileInfo[]> {
		return this.entries;
	}

	async downloadTo(destination: Writable, fromRemotePath: string): Promise<void> {
		this.downloadedPath = fromRemotePath;
		await new Promise<void>((resolve, reject) => {
			destination.once('error', reject);
			destination.end(this.downloadData, resolve);
		});
	}

	async uploadFrom(source: Readable, toRemotePath: string): Promise<void> {
		this.uploadedPath = toRemotePath;
		const chunks: Buffer[] = [];
		for await (const chunk of source) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		this.uploadedData = Buffer.concat(chunks);
	}

	async ensureDir(remoteDirPath: string): Promise<void> {
		this.createdDirectory = remoteDirPath;
	}

	async rename(srcPath: string, destPath: string): Promise<void> {
		this.renamed = { from: srcPath, to: destPath };
	}

	async remove(path: string): Promise<void> {
		this.removedPath = path;
	}

	async removeEmptyDir(path: string): Promise<void> {
		this.removedDirectory = path;
	}

	close(): void {
		this.closed = true;
	}
}
