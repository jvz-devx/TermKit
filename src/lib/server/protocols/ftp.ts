import posixPath from 'node:path/posix';
import { Readable, Transform, Writable } from 'node:stream';
import { Client, FileType, type AccessOptions, type FileInfo } from 'basic-ftp';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { credentialSecretContext } from '$lib/server/services/credentials';
import {
	connectionSessionService,
	type ConnectionSessionLifecycleRecorder
} from '$lib/server/services/connection-sessions';
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
import { normalizeFtpsHostMetadata, type FtpsHostMetadata } from '$lib/termix/host-metadata';

export type FtpProtocol = 'ftp' | 'ftps';
export type FtpsMode = 'explicit' | 'implicit';
export type FtpSecureMode = 'plain' | FtpsMode;
export type FtpActionName =
	| 'list'
	| 'download'
	| 'upload'
	| 'mkdir'
	| 'rename'
	| 'move'
	| 'delete'
	| 'read_text'
	| 'write_text';

export const maxFtpDownloadBytes = 50 * 1024 * 1024;
export const maxFtpUploadBytes = 50 * 1024 * 1024;

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
	secureMode: FtpSecureMode;
	secureOptions?: AccessOptions['secureOptions'];
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

export type FtpFailureCategory =
	| 'validation'
	| 'payload'
	| 'authentication'
	| 'authorization'
	| 'not_found'
	| 'tls'
	| 'network'
	| 'timeout'
	| 'protocol'
	| 'server';

export type FtpFailure = {
	code: string;
	category: FtpFailureCategory;
	message: string;
	status: number;
	details: Record<string, unknown>;
};

export class FtpOperationError extends Error {
	readonly status: number;
	readonly code: string;
	readonly category: FtpFailureCategory;
	readonly issues: string[];
	readonly details: Record<string, unknown>;

	constructor(failure: FtpFailure) {
		super(failure.message);
		this.name = 'FtpOperationError';
		this.status = failure.status;
		this.code = failure.code;
		this.category = failure.category;
		this.issues = [failure.message];
		this.details = failure.details;
	}
}

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

	const secure = resolveSecureMode(protocol, host.metadata);
	const secureOptions = secure.access
		? {
				servername: secure.certificateHostname ?? host.hostname,
				rejectUnauthorized: secure.rejectUnauthorized
			}
		: undefined;
	return {
		userId,
		hostId,
		protocol,
		host: host.hostname,
		port: host.port,
		username,
		password: decryptPasswordCredential(credential, crypto),
		secure: secure.access,
		secureMode: secure.mode,
		...(secureOptions ? { secureOptions } : {})
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

export async function streamFtpFile(
	target: FtpTarget,
	path: string,
	clientFactory: FtpClientFactory = createFtpClient,
	maxBytes = maxFtpDownloadBytes
): Promise<{ body: ReadableStream<Uint8Array>; done: Promise<void> }> {
	const remotePath = validateFtpPath(path);
	const client = clientFactory();

	try {
		await accessFtpTarget(client, target);
	} catch (error) {
		client.close();
		throw error;
	}

	const stream = createLimitedDownloadStream(maxBytes);
	const done = client
		.downloadTo(stream, remotePath)
		.catch((error) => {
			stream.destroy(error instanceof Error ? error : new Error('FTP download failed'));
			throw error;
		})
		.finally(() => {
			client.close();
		})
		.then(() => undefined);

	return {
		body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
		done
	};
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

export async function runRecordedFtpAction<T>(
	userId: string,
	hostId: string,
	action: FtpActionName,
	operation: (target: FtpTarget) => Promise<T>,
	options: {
		path?: string;
		target?: FtpTarget;
		lifecycle?: ConnectionSessionLifecycleRecorder;
	} = {}
): Promise<T> {
	const target = options.target ?? (await resolveFtpTarget(userId, hostId));
	const lifecycle = options.lifecycle ?? connectionSessionService;
	const session = await lifecycle.start({ userId, hostId, protocol: target.protocol });

	try {
		await lifecycle.markActive(session.id);
		const result = await operation(target);
		await lifecycle.end(session.id).catch(() => null);
		return result;
	} catch (error) {
		const failure = classifyFtpFailure(error, { action, target, path: options.path });
		await failLifecycle(lifecycle, session.id, failure).catch(() => null);
		throw toFtpOperationError(error, failure);
	}
}

export async function openRecordedFtpDownload(
	userId: string,
	hostId: string,
	path: string,
	options: {
		target?: FtpTarget;
		lifecycle?: ConnectionSessionLifecycleRecorder;
		clientFactory?: FtpClientFactory;
		maxBytes?: number;
	} = {}
): Promise<{ path: string; body: ReadableStream<Uint8Array>; done: Promise<void> }> {
	const remotePath = validateFtpPath(path);
	const target = options.target ?? (await resolveFtpTarget(userId, hostId));
	const lifecycle = options.lifecycle ?? connectionSessionService;
	const session = await lifecycle.start({ userId, hostId, protocol: target.protocol });

	try {
		await lifecycle.markActive(session.id);
		const download = await streamFtpFile(
			target,
			remotePath,
			options.clientFactory,
			options.maxBytes ?? maxFtpDownloadBytes
		);
		const done = download.done
			.then(() => lifecycle.end(session.id).then(() => undefined))
			.catch(async (error) => {
				const failure = classifyFtpFailure(error, {
					action: 'download',
					target,
					path: remotePath
				});
				await failLifecycle(lifecycle, session.id, failure).catch(() => null);
				throw error;
			});
		return { path: remotePath, body: download.body, done };
	} catch (error) {
		const failure = classifyFtpFailure(error, { action: 'download', target, path: remotePath });
		await failLifecycle(lifecycle, session.id, failure).catch(() => null);
		throw toFtpOperationError(error, failure);
	}
}

async function withFtp<T>(
	target: FtpTarget,
	clientFactory: FtpClientFactory,
	operation: (client: FtpClientLike) => Promise<T>
): Promise<T> {
	const client = clientFactory();
	try {
		await accessFtpTarget(client, target);
		return await operation(client);
	} finally {
		client.close();
	}
}

function accessFtpTarget(client: FtpClientLike, target: FtpTarget): Promise<unknown> {
	return client.access({
		host: target.host,
		port: target.port,
		user: target.username,
		password: target.password,
		secure: target.secure,
		secureOptions: target.secure ? target.secureOptions : undefined
	});
}

function failLifecycle(
	lifecycle: ConnectionSessionLifecycleRecorder,
	sessionId: string,
	failure: FtpFailure
): Promise<unknown> {
	return lifecycle.failWithDetails
		? lifecycle.failWithDetails(sessionId, failure.code, failure.message, failure.details)
		: lifecycle.fail(sessionId, failure.code);
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

function createLimitedDownloadStream(maxBytes: number): Transform {
	let totalBytes = 0;
	return new Transform({
		transform(chunk: Buffer | string, _encoding, callback) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			totalBytes += buffer.byteLength;
			if (totalBytes > maxBytes) {
				callback(new ServicePayloadTooLargeError('FTP download exceeds the 50 MiB limit'));
				return;
			}
			callback(null, buffer);
		}
	});
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
): {
	access: AccessOptions['secure'];
	mode: FtpSecureMode;
	rejectUnauthorized?: boolean;
	certificateHostname?: string | null;
} {
	if (protocol === 'ftp') return { access: false, mode: 'plain' };

	const settings = resolveFtpsHostSettings(metadata);

	if (settings.mode === 'explicit') {
		return {
			access: true,
			mode: settings.mode,
			rejectUnauthorized: settings.rejectUnauthorized,
			certificateHostname: settings.certificateHostname
		};
	}
	if (settings.mode === 'implicit') {
		return {
			access: 'implicit',
			mode: settings.mode,
			rejectUnauthorized: settings.rejectUnauthorized,
			certificateHostname: settings.certificateHostname
		};
	}

	throw new ServiceValidationError(['ftpsMode must be explicit or implicit']);
}

function resolveFtpsHostSettings(metadata: Record<string, unknown>): FtpsHostMetadata {
	const raw = isRecord(metadata.ftps) ? metadata.ftps : metadata;
	const mode = raw.mode ?? raw.ftpsMode ?? metadata.ftpsMode;

	if (mode !== undefined && mode !== 'explicit' && mode !== 'implicit') {
		throw new ServiceValidationError(['ftpsMode must be explicit or implicit']);
	}

	return normalizeFtpsHostMetadata(metadata.ftps, metadata);
}

function isFtpProtocol(protocol: string): protocol is FtpProtocol {
	return protocol === 'ftp' || protocol === 'ftps';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFtpOperationError(error: unknown, failure: FtpFailure): Error {
	if (
		error instanceof ServiceValidationError ||
		error instanceof ServiceNotFoundError ||
		error instanceof ServicePayloadTooLargeError
	) {
		return error;
	}
	return new FtpOperationError(failure);
}

export function classifyFtpFailure(
	error: unknown,
	context: {
		action?: FtpActionName;
		target?: Pick<FtpTarget, 'protocol' | 'secureMode'>;
		path?: string;
	} = {}
): FtpFailure {
	const remoteCode = readNumber(error, 'code');
	const nodeCode = readString(error, 'code');
	const message = error instanceof Error ? error.message : String(error);
	const normalizedMessage = message.toLowerCase();
	const details = compactDetails({
		action: context.action,
		path: context.path,
		protocol: context.target?.protocol,
		ftpsMode: context.target?.secureMode,
		remoteCode,
		nodeCode,
		name: error instanceof Error ? error.name : undefined
	});

	if (error instanceof ServiceValidationError) {
		return {
			code: 'ftp_validation_failed',
			category: 'validation',
			message: error.message,
			status: error.status,
			details
		};
	}
	if (error instanceof ServicePayloadTooLargeError) {
		return {
			code: 'ftp_payload_too_large',
			category: 'payload',
			message: error.message,
			status: error.status,
			details
		};
	}
	if (error instanceof ServiceNotFoundError) {
		return {
			code: 'ftp_path_not_found',
			category: 'not_found',
			message: error.message,
			status: error.status,
			details
		};
	}

	if (isTlsCertificateError(nodeCode, normalizedMessage)) {
		return {
			code: 'ftp_tls_certificate_invalid',
			category: 'tls',
			message: 'FTPS certificate validation failed',
			status: 502,
			details
		};
	}

	if (nodeCode === 'ENOTFOUND' || nodeCode === 'EAI_AGAIN') {
		return {
			code: 'ftp_dns_failed',
			category: 'network',
			message: 'FTP host could not be resolved',
			status: 502,
			details
		};
	}
	if (nodeCode === 'ECONNREFUSED') {
		return {
			code: 'ftp_connection_refused',
			category: 'network',
			message: 'FTP connection was refused',
			status: 502,
			details
		};
	}
	if (nodeCode === 'ETIMEDOUT' || normalizedMessage.includes('timed out')) {
		return {
			code: 'ftp_connection_timeout',
			category: 'timeout',
			message: 'FTP connection timed out',
			status: 504,
			details
		};
	}
	if (nodeCode === 'ECONNRESET' || normalizedMessage.includes('connection reset')) {
		return {
			code: 'ftp_connection_reset',
			category: 'network',
			message: 'FTP connection was reset',
			status: 502,
			details
		};
	}

	if (remoteCode === 530 || normalizedMessage.includes('login incorrect')) {
		return {
			code: 'ftp_auth_failed',
			category: 'authentication',
			message: 'FTP authentication failed',
			status: 502,
			details
		};
	}
	if (remoteCode === 550 && /not found|no such|unavailable/.test(normalizedMessage)) {
		return {
			code: 'ftp_path_not_found',
			category: 'not_found',
			message: 'FTP path was not found',
			status: 404,
			details
		};
	}
	if (remoteCode === 550 || remoteCode === 553 || normalizedMessage.includes('permission denied')) {
		return {
			code: 'ftp_permission_denied',
			category: 'authorization',
			message: 'FTP permission denied',
			status: 403,
			details
		};
	}

	return {
		code: 'ftp_operation_failed',
		category: 'server',
		message: 'FTP operation failed',
		status: 502,
		details
	};
}

function isTlsCertificateError(code: string | undefined, message: string): boolean {
	return (
		code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
		code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
		code === 'CERT_HAS_EXPIRED' ||
		code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
		code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
		code === 'CERT_SIGNATURE_FAILURE' ||
		message.includes('certificate') ||
		message.includes('self signed')
	);
}

function compactDetails(input: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).filter((entry): entry is [string, string | number] => {
			const value = entry[1];
			return typeof value === 'string' || typeof value === 'number';
		})
	);
}

function readString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === 'string' ? field : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === 'number' ? field : undefined;
}
