import posixPath from 'node:path/posix';
import {
	Client,
	type ConnectConfig,
	type FileEntryWithStats,
	type SFTPWrapper,
	type Stats
} from 'ssh2';
import { ServiceNotFoundError, ServiceValidationError } from '$lib/server/services/errors';
import { AesGcmCredentialCrypto } from '$lib/server/services/crypto';
import { termixRepository } from '$lib/server/services/repository';
import type {
	CredentialCrypto,
	CredentialRecord,
	TermixServicesRepository
} from '$lib/server/services/types';
import type { Credential, TicketTarget } from './types';

export type SftpEntry = {
	name: string;
	path: string;
	type: 'directory' | 'file' | 'symlink' | 'other';
	size: number;
	mtime: string;
	mode: number;
	longname: string;
};

export type SftpTarget = TicketTarget;

export function validateSftpPath(value: unknown, field = 'path'): string {
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

export async function resolveSftpTarget(
	userId: string,
	hostId: string,
	repository: TermixServicesRepository = termixRepository,
	crypto: CredentialCrypto = new AesGcmCredentialCrypto()
): Promise<SftpTarget> {
	const host = await repository.getHost(userId, hostId);
	if (!host) throw new ServiceNotFoundError('Host not found');
	if (host.protocol !== 'ssh') {
		throw new ServiceValidationError(['SFTP is only available for SSH hosts']);
	}

	const credential = host.credentialId
		? await repository.getCredential(userId, host.credentialId)
		: null;
	if (host.credentialId && !credential) throw new ServiceNotFoundError('Credential not found');

	const username = credential?.username ?? host.username ?? undefined;
	if (!username)
		throw new ServiceValidationError(['Host username or credential username is required']);

	return {
		host: host.hostname,
		port: host.port,
		username,
		credential: credential ? decryptCredential(credential, crypto) : undefined
	};
}

export async function listSftpDirectory(target: SftpTarget, path: string): Promise<SftpEntry[]> {
	const remotePath = validateSftpPath(path);

	return withSftp(target, async (sftp) => {
		const entries = await readdir(sftp, remotePath);
		return entries
			.map((entry) => toEntry(remotePath, entry))
			.sort((left, right) => {
				if (left.type === 'directory' && right.type !== 'directory') return -1;
				if (left.type !== 'directory' && right.type === 'directory') return 1;
				return left.name.localeCompare(right.name);
			});
	});
}

export async function readSftpFile(target: SftpTarget, path: string): Promise<Buffer> {
	const remotePath = validateSftpPath(path);
	return withSftp(target, (sftp) => readFile(sftp, remotePath));
}

export async function writeSftpFile(target: SftpTarget, path: string, data: Buffer): Promise<void> {
	const remotePath = validateSftpPath(path);
	return withSftp(target, (sftp) => writeFile(sftp, remotePath, data));
}

export async function readSftpTextFile(target: SftpTarget, path: string): Promise<string> {
	const data = await readSftpFile(target, path);
	return data.toString('utf8');
}

export async function writeSftpTextFile(
	target: SftpTarget,
	path: string,
	text: string
): Promise<void> {
	if (typeof text !== 'string') throw new ServiceValidationError(['text is required']);
	await writeSftpFile(target, path, Buffer.from(text, 'utf8'));
}

export async function createSftpDirectory(target: SftpTarget, path: string): Promise<void> {
	const remotePath = validateSftpPath(path);
	return withSftp(target, (sftp) => mkdir(sftp, remotePath));
}

export async function renameSftpPath(
	target: SftpTarget,
	fromPath: string,
	toPath: string
): Promise<void> {
	const from = validateSftpPath(fromPath, 'from');
	const to = validateSftpPath(toPath, 'to');
	if (from === to) throw new ServiceValidationError(['from and to must differ']);
	return withSftp(target, (sftp) => rename(sftp, from, to));
}

export async function deleteSftpPath(target: SftpTarget, path: string): Promise<void> {
	const remotePath = validateSftpPath(path);
	if (remotePath === '/') throw new ServiceValidationError(['path cannot be the filesystem root']);

	return withSftp(target, async (sftp) => {
		const attrs = await stat(sftp, remotePath);
		if (attrs.isDirectory()) await rmdir(sftp, remotePath);
		else await unlink(sftp, remotePath);
	});
}

async function withSftp<T>(
	target: SftpTarget,
	operation: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
	const connection = await connectSsh(target);
	try {
		const sftp = await openSftp(connection);
		return await operation(sftp);
	} finally {
		connection.end();
	}
}

function connectSsh(target: SftpTarget): Promise<Client> {
	const connection = new Client();
	const config: ConnectConfig = {
		host: target.host,
		port: target.port,
		username: target.credential?.username ?? target.username,
		password: target.credential?.kind === 'password' ? target.credential.password : undefined,
		privateKey: target.credential?.kind === 'ssh_key' ? target.credential.privateKey : undefined,
		passphrase: target.credential?.kind === 'ssh_key' ? target.credential.passphrase : undefined
	};

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			connection.off('ready', onReady);
			connection.off('error', onError);
		};
		const onReady = () => {
			cleanup();
			resolve(connection);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		connection.once('ready', onReady);
		connection.once('error', onError);
		connection.connect(config);
	});
}

function openSftp(connection: Client): Promise<SFTPWrapper> {
	return new Promise((resolve, reject) => {
		connection.sftp((error, sftp) => {
			if (error) reject(error);
			else resolve(sftp);
		});
	});
}

function readdir(sftp: SFTPWrapper, path: string): Promise<FileEntryWithStats[]> {
	return new Promise((resolve, reject) => {
		sftp.readdir(path, (error, entries) => {
			if (error) reject(error);
			else resolve(entries);
		});
	});
}

function readFile(sftp: SFTPWrapper, path: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		sftp.readFile(path, (error, data) => {
			if (error) reject(error);
			else resolve(data);
		});
	});
}

function writeFile(sftp: SFTPWrapper, path: string, data: Buffer): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.writeFile(path, data, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function mkdir(sftp: SFTPWrapper, path: string): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.mkdir(path, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function rename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.rename(from, to, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function unlink(sftp: SFTPWrapper, path: string): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.unlink(path, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function rmdir(sftp: SFTPWrapper, path: string): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.rmdir(path, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function stat(sftp: SFTPWrapper, path: string): Promise<Stats> {
	return new Promise((resolve, reject) => {
		sftp.stat(path, (error, attrs) => {
			if (error) reject(error);
			else resolve(attrs);
		});
	});
}

function toEntry(directory: string, entry: FileEntryWithStats): SftpEntry {
	const attrs = entry.attrs;
	return {
		name: entry.filename,
		path: posixPath.join(directory, entry.filename),
		type: attrs.isDirectory()
			? 'directory'
			: attrs.isFile()
				? 'file'
				: attrs.isSymbolicLink()
					? 'symlink'
					: 'other',
		size: attrs.size,
		mtime: new Date(attrs.mtime * 1000).toISOString(),
		mode: attrs.mode,
		longname: entry.longname
	};
}

function decryptCredential(credential: CredentialRecord, crypto: CredentialCrypto): Credential {
	const secret = crypto.decrypt({
		ciphertext: credential.encryptedSecret,
		metadata: credential.encryption
	});

	if (credential.kind === 'password') {
		return {
			kind: 'password',
			username: credential.username ?? undefined,
			password: secret
		};
	}

	return {
		kind: 'ssh_key',
		username: credential.username ?? undefined,
		privateKey: secret,
		passphrase:
			typeof credential.metadata.passphrase === 'string'
				? credential.metadata.passphrase
				: undefined
	};
}
