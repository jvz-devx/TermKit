import { Writable, type Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FileInfo, FileType, type AccessOptions } from 'basic-ftp';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { StartConnectionSessionInput } from '$lib/server/services/connection-sessions';
import type { CredentialRecord, HostRecord } from '$lib/server/services/types';
import {
	classifyFtpFailure,
	createFtpDirectory,
	deleteFtpPath,
	FtpOperationError,
	listFtpDirectory,
	openRecordedFtpDownload,
	readFtpFile,
	renameFtpPath,
	resolveFtpTarget,
	runRecordedFtpAction,
	streamFtpFile,
	validateFtpPath,
	writeFtpFile,
	readFtpTextFile,
	writeFtpTextFile,
	type FtpClientLike,
	type FtpTarget
} from './ftp';

describe('FTP path validation', () => {
	it('normalizes absolute remote paths', () => {
		expect(validateFtpPath('/srv/app//logs/')).toBe('/srv/app/logs');
		expect(validateFtpPath(' /srv/app/./logs/ ')).toBe('/srv/app/logs');
	});

	it('rejects relative and traversal paths', () => {
		expect(() => validateFtpPath('', 'remotePath')).toThrow(ServiceValidationError);
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

	it('requires distinct absolute paths for rename operations', async () => {
		await expect(
			renameFtpPath(testTarget(), '/srv/app.txt', '/srv/app.txt', () => new FakeFtpClient())
		).rejects.toMatchObject({ issues: ['from and to must differ'] });

		await expect(
			renameFtpPath(testTarget(), '/srv/app.txt', '../escape.txt', () => new FakeFtpClient())
		).rejects.toMatchObject({ issues: ['to must be absolute'] });
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
			secure: false,
			secureMode: 'plain'
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
		).resolves.toMatchObject({ protocol: 'ftps', secure: true, secureMode: 'explicit' });

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
		).resolves.toMatchObject({ protocol: 'ftps', secure: 'implicit', secureMode: 'implicit' });
	});

	it('falls back to the host username when the password credential has no username', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password',
			username: null
		});
		await repository.createHost(
			testHost({ credentialId: credential.id, protocol: 'ftp', username: 'host-user' })
		);

		await expect(resolveFtpTarget('user-1', 'host-1', repository, crypto)).resolves.toMatchObject({
			username: 'host-user',
			password: 'saved-password'
		});
	});

	it('passes FTPS certificate policy metadata into TLS access options', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password'
		});
		await repository.createHost(
			testHost({
				credentialId: credential.id,
				protocol: 'ftps',
				metadata: {
					ftps: {
						mode: 'implicit',
						rejectUnauthorized: false,
						certificateHostname: 'edge.example.test'
					}
				}
			})
		);

		await expect(resolveFtpTarget('user-1', 'host-1', repository, crypto)).resolves.toMatchObject({
			protocol: 'ftps',
			secure: 'implicit',
			secureMode: 'implicit',
			secureOptions: {
				servername: 'edge.example.test',
				rejectUnauthorized: false
			}
		});
	});

	it('rejects invalid FTPS mode metadata instead of silently downgrading settings', async () => {
		const { repository, crypto, credential } = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password'
		});
		await repository.createHost(
			testHost({
				credentialId: credential.id,
				protocol: 'ftps',
				metadata: { ftps: { mode: 'disabled' } }
			})
		);

		await expect(resolveFtpTarget('user-1', 'host-1', repository, crypto)).rejects.toMatchObject({
			issues: ['ftpsMode must be explicit or implicit']
		});
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

	it('rejects unsupported hosts, missing credentials, and username-less targets before access', async () => {
		const unsupported = new InMemoryTermixServicesRepository();
		await unsupported.createHost(testHost({ protocol: 'ssh', credentialId: null }));

		await expect(resolveFtpTarget('user-1', 'host-1', unsupported)).rejects.toMatchObject({
			issues: ['FTP is only available for FTP or FTPS hosts']
		});

		const noCredential = new InMemoryTermixServicesRepository();
		await noCredential.createHost(testHost({ credentialId: null }));

		await expect(resolveFtpTarget('user-1', 'host-1', noCredential)).rejects.toMatchObject({
			issues: ['FTP/FTPS requires a saved password credential']
		});

		const missingCredential = new InMemoryTermixServicesRepository();
		await missingCredential.createHost(testHost({ credentialId: 'credential-404' }));

		await expect(resolveFtpTarget('user-1', 'host-1', missingCredential)).rejects.toMatchObject({
			message: 'Credential not found'
		});

		const usernameLess = await createEncryptedCredential({
			kind: 'password',
			secret: 'saved-password',
			username: null
		});
		await usernameLess.repository.createHost(
			testHost({ credentialId: usernameLess.credential.id, username: null })
		);

		await expect(
			resolveFtpTarget('user-1', 'host-1', usernameLess.repository, usernameLess.crypto)
		).rejects.toMatchObject({
			issues: ['Host username or credential username is required']
		});
	});
});

describe('FTP file operations', () => {
	it('lists directories with normalized entries and explicit FTPS access options', async () => {
		const client = new FakeFtpClient([
			fileInfo('z.txt', FileType.File, {
				size: 12,
				modifiedAt: new Date('2026-05-14T10:00:00Z'),
				permissions: { user: 6, group: 4, world: 0 },
				user: 'deploy',
				group: 'www'
			}),
			fileInfo('current', FileType.SymbolicLink, { link: 'z.txt' }),
			fileInfo('app', FileType.Directory)
		]);

		const entries = await listFtpDirectory(
			testTarget({
				secure: true,
				secureOptions: { servername: 'files.example.test', rejectUnauthorized: true }
			}),
			'/srv',
			() => client
		);

		expect(client.accessOptions).toMatchObject({
			host: 'files.example.test',
			port: 21,
			user: 'ops',
			password: 'secret',
			secure: true,
			secureOptions: { servername: 'files.example.test', rejectUnauthorized: true }
		});
		expect(client.closed).toBe(true);
		expect(entries).toEqual([
			expect.objectContaining({ name: 'app', path: '/srv/app', type: 'directory' }),
			expect.objectContaining({
				name: 'current',
				path: '/srv/current',
				type: 'symlink',
				link: 'z.txt'
			}),
			expect.objectContaining({
				name: 'z.txt',
				path: '/srv/z.txt',
				type: 'file',
				size: 12,
				mtime: '2026-05-14T10:00:00.000Z',
				mode: 0o640,
				user: 'deploy',
				group: 'www'
			})
		]);
	});

	it('closes clients when access or path lookup fails', async () => {
		const accessFailure = new FakeFtpClient();
		accessFailure.accessError = Object.assign(new Error('530 Login incorrect'), { code: 530 });

		await expect(listFtpDirectory(testTarget(), '/srv', () => accessFailure)).rejects.toThrow(
			'530 Login incorrect'
		);
		expect(accessFailure.closed).toBe(true);

		const missingPath = new FakeFtpClient([fileInfo('other.txt', FileType.File)]);

		await expect(
			deleteFtpPath(testTarget(), '/srv/missing.txt', () => missingPath)
		).rejects.toMatchObject({
			message: 'Path not found'
		});
		expect(missingPath.closed).toBe(true);
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

	it('rejects oversized uploads before opening an FTP connection', async () => {
		let clientCreated = false;

		await expect(
			writeFtpFile(
				testTarget(),
				'/tmp/large.bin',
				Buffer.from('too-large'),
				() => {
					clientCreated = true;
					return new FakeFtpClient();
				},
				4
			)
		).rejects.toThrow(ServicePayloadTooLargeError);
		expect(clientCreated).toBe(false);
	});

	it('passes implicit FTPS settings directly to the FTP client access call', async () => {
		const client = new FakeFtpClient();

		await listFtpDirectory(
			testTarget({
				protocol: 'ftps',
				secure: 'implicit',
				secureMode: 'implicit',
				secureOptions: { servername: 'implicit.example.test', rejectUnauthorized: true }
			}),
			'/srv',
			() => client
		);

		expect(client.accessOptions).toMatchObject({
			secure: 'implicit',
			secureOptions: {
				servername: 'implicit.example.test',
				rejectUnauthorized: true
			}
		});
		expect(client.closed).toBe(true);
	});

	it('streams downloads server-side while closing the FTP client after completion', async () => {
		const client = new FakeFtpClient();
		client.downloadData = Buffer.from('streamed');

		const download = await streamFtpFile(testTarget(), '/tmp/message.txt', () => client);
		const body = await new Response(download.body).arrayBuffer();
		await download.done;

		expect(Buffer.from(body)).toEqual(Buffer.from('streamed'));
		expect(client.downloadedPath).toBe('/tmp/message.txt');
		expect(client.closed).toBe(true);
	});

	it('reads and writes text files using UTF-8 buffers', async () => {
		const client = new FakeFtpClient();
		client.downloadData = Buffer.from('hello text', 'utf8');

		await expect(readFtpTextFile(testTarget(), '/tmp/message.txt', () => client)).resolves.toBe(
			'hello text'
		);
		await writeFtpTextFile(testTarget(), '/tmp/message.txt', 'saved text', () => client);

		expect(client.uploadedData.toString('utf8')).toBe('saved text');
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

describe('FTP failures and recorded lifecycle', () => {
	it('maps TLS certificate failures to stable public details', () => {
		const error = Object.assign(new Error('self signed certificate'), {
			code: 'DEPTH_ZERO_SELF_SIGNED_CERT'
		});

		expect(classifyFtpFailure(error, { action: 'list', target: testTarget() })).toMatchObject({
			code: 'ftp_tls_certificate_invalid',
			category: 'tls',
			message: 'FTPS certificate validation failed',
			status: 502,
			details: {
				action: 'list',
				protocol: 'ftp',
				ftpsMode: 'plain',
				nodeCode: 'DEPTH_ZERO_SELF_SIGNED_CERT'
			}
		});
	});

	it('maps FTP response and network errors without leaking credentials', () => {
		const auth = Object.assign(new Error('530 Login incorrect'), { code: 530 });
		const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
		const dns = Object.assign(new Error('getaddrinfo ENOTFOUND files.example.test'), {
			code: 'ENOTFOUND'
		});
		const timeout = Object.assign(new Error('control socket timed out'), { code: 'ETIMEDOUT' });
		const notFound = Object.assign(new Error('550 No such file'), { code: 550 });
		const denied = Object.assign(new Error('553 Permission denied'), { code: 553 });

		expect(classifyFtpFailure(auth)).toMatchObject({
			code: 'ftp_auth_failed',
			category: 'authentication'
		});
		expect(classifyFtpFailure(refused)).toMatchObject({
			code: 'ftp_connection_refused',
			category: 'network'
		});
		expect(classifyFtpFailure(dns)).toMatchObject({
			code: 'ftp_dns_failed',
			category: 'network'
		});
		expect(classifyFtpFailure(timeout)).toMatchObject({
			code: 'ftp_connection_timeout',
			category: 'timeout'
		});
		expect(classifyFtpFailure(notFound)).toMatchObject({
			code: 'ftp_path_not_found',
			category: 'not_found',
			status: 404
		});
		expect(classifyFtpFailure(denied)).toMatchObject({
			code: 'ftp_permission_denied',
			category: 'authorization',
			status: 403
		});
	});

	it('records action lifecycle success and structured failures', async () => {
		const lifecycle = new FakeLifecycleRecorder();

		await expect(
			runRecordedFtpAction('user-1', 'host-1', 'mkdir', async () => 'ok', {
				lifecycle,
				path: '/srv/new',
				target: testTarget()
			})
		).resolves.toBe('ok');

		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active', 'end']);

		await expect(
			runRecordedFtpAction(
				'user-1',
				'host-1',
				'delete',
				async () => {
					throw Object.assign(new Error('self signed certificate'), {
						code: 'DEPTH_ZERO_SELF_SIGNED_CERT'
					});
				},
				{ lifecycle, path: '/srv/secret.txt', target: testTarget() }
			)
		).rejects.toThrow(FtpOperationError);

		expect(lifecycle.calls.at(-1)).toMatchObject({
			action: 'fail',
			errorCode: 'ftp_tls_certificate_invalid',
			errorMessage: 'FTPS certificate validation failed',
			errorDetails: expect.objectContaining({
				action: 'delete',
				path: '/srv/secret.txt',
				nodeCode: 'DEPTH_ZERO_SELF_SIGNED_CERT'
			})
		});
	});

	it('records streamed download lifecycle after the transfer completes', async () => {
		const lifecycle = new FakeLifecycleRecorder();
		const client = new FakeFtpClient();
		client.downloadData = Buffer.from('download body');

		const download = await openRecordedFtpDownload('user-1', 'host-1', '/srv/file.txt', {
			lifecycle,
			target: testTarget(),
			clientFactory: () => client
		});

		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active']);
		await new Response(download.body).arrayBuffer();
		await download.done;

		expect(lifecycle.calls.map((call) => call.action)).toEqual(['start', 'active', 'end']);
	});

	it('records streamed download failures after response creation', async () => {
		const lifecycle = new FakeLifecycleRecorder();
		const client = new FakeFtpClient();
		client.downloadError = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });

		const download = await openRecordedFtpDownload('user-1', 'host-1', '/srv/file.txt', {
			lifecycle,
			target: testTarget(),
			clientFactory: () => client
		});

		await expect(new Response(download.body).arrayBuffer()).rejects.toThrow();
		await expect(download.done).rejects.toThrow();
		expect(lifecycle.calls.at(-1)).toMatchObject({
			action: 'fail',
			errorCode: 'ftp_connection_reset'
		});
	});
});

async function createEncryptedCredential(input: {
	kind: 'password' | 'ssh_key';
	secret: string;
	username?: string | null;
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
		username: input.username === undefined ? 'credential-user' : input.username,
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
		secureMode: 'plain',
		...patch
	};
}

function fileInfo(
	name: string,
	type: FileType,
	patch: Partial<
		Pick<
			FileInfo,
			'size' | 'modifiedAt' | 'rawModifiedAt' | 'permissions' | 'link' | 'user' | 'group'
		>
	> = {}
): FileInfo {
	const entry = new FileInfo(name);
	entry.type = type;
	entry.size = patch.size ?? 0;
	entry.modifiedAt = patch.modifiedAt;
	entry.rawModifiedAt = patch.rawModifiedAt ?? '';
	entry.permissions = patch.permissions;
	entry.link = patch.link;
	entry.user = patch.user;
	entry.group = patch.group;
	return entry;
}

class FakeFtpClient implements FtpClientLike {
	accessOptions: AccessOptions | null = null;
	accessError: Error | null = null;
	closed = false;
	downloadData = Buffer.alloc(0);
	downloadError: Error | null = null;
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
		if (this.accessError) throw this.accessError;
	}

	async list(): Promise<FileInfo[]> {
		return this.entries;
	}

	async downloadTo(destination: Writable, fromRemotePath: string): Promise<void> {
		this.downloadedPath = fromRemotePath;
		if (this.downloadError) throw this.downloadError;
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

type LifecycleCall =
	| { action: 'start'; id: string; protocol: StartConnectionSessionInput['protocol'] }
	| { action: 'active'; id: string }
	| { action: 'end'; id: string }
	| {
			action: 'fail';
			id: string;
			errorCode: string;
			errorMessage: string;
			errorDetails: Record<string, unknown>;
	  };

class FakeLifecycleRecorder {
	calls: LifecycleCall[] = [];
	private nextId = 1;

	async start(input: StartConnectionSessionInput) {
		const id = `session-${this.nextId++}`;
		this.calls.push({ action: 'start', id, protocol: input.protocol });
		return {
			id,
			userId: 'user-1',
			workspaceId: null,
			hostId: 'host-1',
			protocol: input.protocol,
			status: 'starting' as const,
			startedAt: new Date(),
			endedAt: null,
			errorCode: null,
			updatedAt: new Date()
		};
	}

	async markActive(id: string) {
		this.calls.push({ action: 'active', id });
		return null;
	}

	async end(id: string) {
		this.calls.push({ action: 'end', id });
		return null;
	}

	async failWithDetails(
		id: string,
		errorCode: string,
		errorMessage: string,
		errorDetails: Record<string, unknown>
	) {
		this.calls.push({ action: 'fail', id, errorCode, errorMessage, errorDetails });
		return null;
	}

	async fail(id: string, errorCode: string) {
		this.calls.push({ action: 'fail', id, errorCode, errorMessage: errorCode, errorDetails: {} });
		return null;
	}
}
