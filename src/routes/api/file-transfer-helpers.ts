import posixPath from 'node:path/posix';
import type { RequestEvent } from '@sveltejs/kit';
import { readJsonObject, requireParam, requireUser } from './_helpers';
import { connectionSessionService } from '$lib/server/services/connection-sessions';
import type { ConnectionProtocol, ConnectionSessionRecord } from '$lib/server/services/types';

type PathValidator = (value: unknown, field?: string) => string;

export function requireFileTransferContext(event: RequestEvent) {
	return {
		userId: requireUser(event),
		hostId: requireParam(event.params.hostId, 'hostId')
	};
}

export function readQueryPath(
	event: RequestEvent,
	validatePath: PathValidator,
	defaultPath?: string
): string {
	return validatePath(event.url.searchParams.get('path') ?? defaultPath);
}

export async function readJsonPath(
	event: RequestEvent,
	validatePath: PathValidator,
	field = 'path'
): Promise<string> {
	const input = await readJsonObject(event.request);
	return validatePath(input[field], field);
}

export async function readJsonRename(event: RequestEvent, validatePath: PathValidator) {
	const input = await readJsonObject(event.request);
	return {
		from: validatePath(input.from, 'from'),
		to: validatePath(input.to, 'to')
	};
}

export function downloadResponse(path: string, body: BodyInit, byteLength?: number): Response {
	const headers: Record<string, string> = {
		'content-type': 'application/octet-stream',
		'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(posixPath.basename(path))}`
	};
	if (byteLength !== undefined) headers['content-length'] = String(byteLength);
	return new Response(body, { headers });
}

export async function runRecordedFileTransferAction<T>(
	input: {
		userId: string;
		hostId: string;
		protocol: Extract<ConnectionProtocol, 'sftp' | 'ftp' | 'ftps'>;
		action: string;
		path?: string;
		lifecycle?: FileTransferLifecycleRecorder;
	},
	operation: () => Promise<T>
): Promise<T> {
	const lifecycle = input.lifecycle ?? connectionSessionService;
	const session = await lifecycle.start({
		userId: input.userId,
		hostId: input.hostId,
		protocol: input.protocol
	});

	try {
		await lifecycle.markActive(session.id);
		const result = await operation();
		await lifecycle.end(session.id).catch(() => null);
		return result;
	} catch (error) {
		await recordFileTransferFailure(lifecycle, session.id, input, error).catch(() => null);
		throw error;
	}
}

type FileTransferLifecycleRecorder = {
	start(input: {
		userId: string;
		hostId: string;
		protocol: ConnectionProtocol;
	}): Promise<ConnectionSessionRecord>;
	markActive(id: string): Promise<ConnectionSessionRecord | null>;
	end(id: string): Promise<ConnectionSessionRecord | null>;
	fail(id: string, errorCode: string): Promise<ConnectionSessionRecord | null>;
	failWithDetails?(
		id: string,
		errorCode: string,
		errorMessage: string,
		errorDetails?: Record<string, unknown>
	): Promise<ConnectionSessionRecord | null>;
};

async function recordFileTransferFailure(
	lifecycle: FileTransferLifecycleRecorder,
	sessionId: string,
	input: {
		protocol: Extract<ConnectionProtocol, 'sftp' | 'ftp' | 'ftps'>;
		action: string;
		path?: string;
	},
	error: unknown
): Promise<void> {
	const errorCode = `${input.protocol}_${input.action}_failed`;
	if (lifecycle.failWithDetails) {
		await lifecycle.failWithDetails(sessionId, errorCode, errorMessage(error), {
			protocol: input.protocol,
			action: input.action,
			path: input.path ?? null
		});
		return;
	}
	await lifecycle.fail(sessionId, errorCode);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'File transfer operation failed';
}
