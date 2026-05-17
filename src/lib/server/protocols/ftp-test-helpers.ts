import { Writable, type Readable } from 'node:stream';
import { FileInfo, type AccessOptions, type FileType } from 'basic-ftp';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { CredentialService } from '$lib/server/services/credentials';
import { InMemoryTermixServicesRepository } from '$lib/server/services/repository';
import type { StartConnectionSessionInput } from '$lib/server/services/connection-sessions';
import type { CredentialRecord, HostRecord } from '$lib/server/services/types';
import type { FtpClientLike, FtpTarget } from './ftp';

export async function createEncryptedCredential(input: {
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

export function testHost(patch: Partial<HostRecord> & { protocol?: string } = {}): HostRecord {
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

export function testTarget(patch: Partial<FtpTarget> = {}): FtpTarget {
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

export function fileInfo(
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

export class FakeFtpClient implements FtpClientLike {
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

export type LifecycleCall =
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

export class FakeLifecycleRecorder {
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
