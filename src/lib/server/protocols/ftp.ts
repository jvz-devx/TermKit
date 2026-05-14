import posixPath from 'node:path/posix';
import { Readable, Writable } from 'node:stream';
import { Client, FileType, type AccessOptions, type FileInfo } from 'basic-ftp';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { credentialSecretContext } from '$lib/server/services/credentials';
import {
	ServiceNotFoundError,
	ServicePayloadTooLargeError,
	ServiceValidationError
} from '$lib/server/services/errors';
import { termixRepository } from '$lib/server/services/repository';
import type {
	CredentialCrypto,
	CredentialRecord,
	TermixServicesRepository
} from '$lib/server/services/types';

export type FtpProtocol = 'ftp' | 'ftps';
export const maxFtpDownloadBytes = 50 * 1024 * 1024;

export type FtpEntry = {
	name: string;
	path: string;
	type: 'directory' | 'file' | 'symlink' | 'other';
	size: number;
	mtime: string | null;
	rawModifiedAt: string | null;
	mode: number | null;
	link: string | null;
	user: string | null;
	group: string | null;
};

export type FtpTarget = {
	userId: string;
	hostId: string;
	protocol: FtpProtocol;
	host: string;
	port: number;
	username: string;
	password: string;
	secure: AccessOptions['secure'];
};

export type FtpClientLike = {
	access(options: AccessOptions): Promise<unknown>;
	list(path?: string): Promise<FileInfo[]>;
	downloadTo(destination: Writable, fromRemotePath: string, startAt?: number): Promise<unknown>;
	uploadFrom(source: Readable, toRemotePath: string): Promise<unknown>;
	ensureDir(remoteDirPath: string): Promise<void>;
	rename(srcPath: string, destPath: string): Promise<unknown>;
	remove(path: string): Promise<unknown>;
	removeEmptyDir(path: string): Promise<unknown>;
	close(): void;
};

export type FtpClientFactory = () => FtpClientLike;

export function createFtpClient(): FtpClientLike {
	return new Client(30_000, { allowSeparateTransferHost: false });
}

export function validateFtpPath(value: unknown, field = 'path'): string {
	const path = typeof value === 'string' ? value.trim() : '';

	if (!path) throw new ServiceValidationError([`${field} is required`]);
	if (path.includes('\0')) throw new ServiceValidationError([`${field} cannot contain NUL bytes`]);
	if (!path.startsWith('/')) throw new ServiceValidationError([`${field} must be absolute`]);

	const segments = path.split('/').filter(Boolean);
	if (segments.includes('..')) {
		throw new ServiceValidationError([`${field} cannot contain parent directory traversal`]);
	}

	const normalized = posixPath.normalize(path);
	if (normalized === '.') return '/';
	return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

export async function resolveFtpTarget(
	userId: string,
	hostId: string,
	repository: TermixServicesRepository = termixRepository,
	crypto: CredentialCrypto = new AesGcmCredentialCrypto()
): Promise<FtpTarget> {
	const host = await repository.getHost(userId, hostId);
	if (!host) throw new ServiceNotFoundError('Host not found');

	const protocol = String(host.protocol);
	if (!isFtpProtocol(protocol)) {
		throw new ServiceValidationError(['FTP is only available for FTP or FTPS hosts']);
	}

	if (!host.credentialId) {
		throw new ServiceValidationError(['FTP/FTPS requires a saved password credential']);
	}

	const credential = await repository.getCredential(userId, host.credentialId);
	if (!credential) throw new ServiceNotFoundError('Credential not found');
	if (credential.kind !== 'password') {
		throw new ServiceValidationError(['FTP/FTPS does not support SSH key credentials']);
	}

	const username = credential.username ?? host.username ?? undefined;
	if (!username) {
		throw new ServiceValidationError(['Host username or credential username is required']);
	}

	return {
		userId,
		hostId,
		protocol,
		host: host.hostname,
		port: host.port,
		username,
		password: decryptPasswordCredential(credential, crypto),
		secure: resolveSecureMode(protocol, host.metadata)
	};
}

export async function listFtpDirectory(
	target: FtpTarget,
	path: string,
	clientFactory: FtpClientFactory = createFtpClient
): Promise<FtpEntry[]> {
	const remotePath = validateFtpPath(path);

	return withFtp(target, clientFactory, async (client) => {
		const entries = await client.list(remotePath);
		return entries
			.map((entry) => toEntry(remotePath, entry))
			.sort((left, right) => {
				if (left.type === 'directory' && right.type !== 'directory') return -1;
				if (left.type !== 'directory' && right.type === 'directory') return 1;
				return left.name.localeCompare(right.name);
			});
	});
}

export async function readFtpFile(
	target: FtpTarget,
	path: string,
	clientFactory: FtpClientFactory = createFtpClient,
	maxBytes = maxFtpDownloadBytes
): Promise<Buffer> {
	const remotePath = validateFtpPath(path);
	return withFtp(target, clientFactory, (client) => downloadToBuffer(client, remotePath, maxBytes));
}

export async function writeFtpFile(
	target: FtpTarget,
	path: string,
	data: Buffer,
	clientFactory: FtpClientFactory = createFtpClient
): Promise<void> {
	const remotePath = validateFtpPath(path);
	return withFtp(target, clientFactory, async (client) => {
		await client.uploadFrom(Readable.from([data]), remotePath);
	});
}

export async function readFtpTextFile(
	target: FtpTarget,
	path: string,
	clientFactory: FtpClientFactory = createFtpClient
): Promise<string> {
	const data = await readFtpFile(target, path, clientFactory);
	return data.toString('utf8');
}

export async function writeFtpTextFile(
	target: FtpTarget,
	path: string,
	text: string,
	clientFactory: FtpClientFactory = createFtpClient
): Promise<void> {
	if (typeof text !== 'string') throw new ServiceValidationError(['text is required']);
	await writeFtpFile(target, path, Buffer.from(text, 'utf8'), clientFactory);
}

export async function createFtpDirectory(
	target: FtpTarget,
	path: string,
	clientFactory: FtpClientFactory = createFtpClient
): Promise<void> {
	const remotePath = validateFtpPath(path);
	return withFtp(target, clientFactory, (client) => client.ensureDir(remotePath));
}

export async function renameFtpPath(
	target: FtpTarget,
	fromPath: string,
	toPath: string,
	clientFactory: FtpClientFactory = createFtpClient
): Promise<void> {
	const from = validateFtpPath(fromPath, 'from');
	const to = validateFtpPath(toPath, 'to');
	if (from === to) throw new ServiceValidationError(['from and to must differ']);

	return withFtp(target, clientFactory, async (client) => {
		await client.rename(from, to);
	});
}

export async function deleteFtpPath(
	target: FtpTarget,
	path: string,
	clientFactory: FtpClientFactory = createFtpClient
): Promise<void> {
	const remotePath = validateFtpPath(path);
	if (remotePath === '/') throw new ServiceValidationError(['path cannot be the filesystem root']);

	return withFtp(target, clientFactory, async (client) => {
		const entry = await findFtpEntry(client, remotePath);
		if (isDirectory(entry)) await client.removeEmptyDir(remotePath);
		else await client.remove(remotePath);
	});
}

async function withFtp<T>(
	target: FtpTarget,
	clientFactory: FtpClientFactory,
	operation: (client: FtpClientLike) => Promise<T>
): Promise<T> {
	const client = clientFactory();
	try {
		await client.access({
			host: target.host,
			port: target.port,
			user: target.username,
			password: target.password,
			secure: target.secure,
			secureOptions: target.secure ? { servername: target.host } : undefined
		});
		return await operation(client);
	} finally {
		client.close();
	}
}

async function downloadToBuffer(
	client: FtpClientLike,
	path: string,
	maxBytes: number
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	let limitError: ServicePayloadTooLargeError | null = null;
	const destination = new Writable({
		write(chunk: Buffer | string, _encoding, callback) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			totalBytes += buffer.byteLength;
			if (totalBytes > maxBytes) {
				limitError = new ServicePayloadTooLargeError('FTP download exceeds the 50 MiB limit');
				callback(limitError);
				return;
			}
			chunks.push(buffer);
			callback();
		}
	});

	await client.downloadTo(destination, path);
	if (limitError) throw limitError;
	return Buffer.concat(chunks);
}

async function findFtpEntry(client: FtpClientLike, path: string): Promise<FileInfo> {
	const parent = posixPath.dirname(path);
	const name = posixPath.basename(path);
	const entries = await client.list(parent === '.' ? '/' : parent);
	const entry = entries.find((candidate) => candidate.name === name);
	if (!entry) throw new ServiceNotFoundError('Path not found');
	return entry;
}

function toEntry(directory: string, entry: FileInfo): FtpEntry {
	return {
		name: entry.name,
		path: posixPath.join(directory, entry.name),
		type: entryType(entry),
		size: entry.size,
		mtime: entry.modifiedAt ? entry.modifiedAt.toISOString() : null,
		rawModifiedAt: entry.rawModifiedAt || null,
		mode: permissionsToMode(entry.permissions),
		link: entry.link ?? null,
		user: entry.user ?? null,
		group: entry.group ?? null
	};
}

function entryType(entry: FileInfo): FtpEntry['type'] {
	if (isDirectory(entry)) return 'directory';
	if (entry.isFile || entry.type === FileType.File) return 'file';
	if (entry.isSymbolicLink || entry.type === FileType.SymbolicLink) return 'symlink';
	return 'other';
}

function isDirectory(entry: FileInfo): boolean {
	return entry.isDirectory || entry.type === FileType.Directory;
}

function permissionsToMode(permissions: FileInfo['permissions']): number | null {
	if (!permissions) return null;
	return (permissions.user << 6) | (permissions.group << 3) | permissions.world;
}

function decryptPasswordCredential(credential: CredentialRecord, crypto: CredentialCrypto): string {
	return crypto.decrypt(
		{
			ciphertext: credential.encryptedSecret,
			metadata: credential.encryption
		},
		credentialSecretContext(credential.userId, credential.id)
	);
}

function resolveSecureMode(
	protocol: FtpProtocol,
	metadata: Record<string, unknown>
): AccessOptions['secure'] {
	if (protocol === 'ftp') return false;
	return metadata.ftpsMode === 'implicit' ? 'implicit' : true;
}

function isFtpProtocol(protocol: string): protocol is FtpProtocol {
	return protocol === 'ftp' || protocol === 'ftps';
}
