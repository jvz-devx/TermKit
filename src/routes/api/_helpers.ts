import { json, type RequestEvent } from '@sveltejs/kit';
import {
	ServicePayloadTooLargeError,
	ServiceUnauthorizedError,
	ServiceValidationError
} from '$lib/server/services/errors';

export const IMPORT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const SFTP_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export function requireUser(event: RequestEvent): string {
	const userId = event.locals.user?.id;
	if (!userId) throw new ServiceUnauthorizedError();
	return userId;
}

export function requireParam(value: string | undefined, name: string): string {
	if (!value) throw new Error(`Missing route parameter: ${name}`);
	return value;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => ({}));
	return isRecord(body) ? body : {};
}

export async function readRequiredFormFile(
	request: Request,
	field: string,
	maxBytes: number
): Promise<File> {
	assertContentLength(request, maxBytes);
	const form = await request.formData().catch(() => null);
	const file = form?.get(field);
	if (!(file instanceof File)) {
		throw new ServiceValidationError([`${field} is required`]);
	}
	if (file.size > maxBytes) {
		throw new ServicePayloadTooLargeError(
			`${field} exceeds the ${formatBytes(maxBytes)} upload limit`
		);
	}
	return file;
}

export function assertContentLength(request: Request, maxBytes: number): void {
	const raw = request.headers.get('content-length');
	if (!raw) return;
	const contentLength = raw.trim();
	if (!/^\d+$/.test(contentLength)) {
		throw new ServiceValidationError(['content-length must be a non-negative integer']);
	}
	if (BigInt(contentLength) > BigInt(maxBytes)) {
		throw new ServicePayloadTooLargeError(
			`request exceeds the ${formatBytes(maxBytes)} upload limit`
		);
	}
}

export function serviceJson(error: unknown): Response {
	const status = getStatus(error);
	const message = error instanceof Error ? error.message : 'Unexpected error';
	const issues = isIssueError(error) ? error.issues : undefined;

	return json({ error: message, issues }, { status });
}

function getStatus(error: unknown): number {
	if (isStatusError(error)) return error.status;
	return 500;
}

function isStatusError(error: unknown): error is { status: number } {
	return isRecord(error) && typeof error.status === 'number';
}

function isIssueError(error: unknown): error is { issues: string[] } {
	return isRecord(error) && Array.isArray(error.issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function formatBytes(bytes: number): string {
	const mib = bytes / 1024 / 1024;
	return Number.isInteger(mib) ? `${mib} MiB` : `${bytes} bytes`;
}
