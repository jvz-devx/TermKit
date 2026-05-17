import posixPath from 'node:path/posix';
import type { RequestEvent } from '@sveltejs/kit';
import { readJsonObject, requireParam, requireUser } from './_helpers';

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
