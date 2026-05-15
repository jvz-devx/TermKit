import { json, type RequestEvent } from '@sveltejs/kit';
import {
	ServicePayloadTooLargeError,
	ServiceUnauthorizedError,
	ServiceValidationError
} from '$lib/server/services/errors';

export const IMPORT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const SFTP_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const MULTIPART_UPLOAD_ENVELOPE_MAX_BYTES = 64 * 1024;

type MultipartFileOptions = {
	maxBodyBytes?: number;
};

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
	maxBytes: number,
	options: MultipartFileOptions = {}
): Promise<File> {
	const form = await readMultipartFormData(request, maxBytes, options);
	return getRequiredFormFile(form, field, maxBytes);
}

export async function readMultipartFormData(
	request: Request,
	maxFileBytes: number,
	options: MultipartFileOptions = {}
): Promise<FormData> {
	const maxBodyBytes = options.maxBodyBytes ?? multipartUploadBodyLimit(maxFileBytes);
	assertContentLength(request, maxBodyBytes, maxFileBytes);

	try {
		return await requestWithMultipartBodyLimit(request, maxBodyBytes, maxFileBytes).formData();
	} catch (error) {
		if (error instanceof ServicePayloadTooLargeError) throw error;
		return new FormData();
	}
}

export function getRequiredFormFile(form: FormData, field: string, maxBytes: number): File {
	const file = form.get(field);
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

export function assertContentLength(
	request: Request,
	maxBytes: number,
	displayMaxBytes = maxBytes
): void {
	const raw = request.headers.get('content-length');
	if (!raw) return;
	const contentLength = raw.trim();
	if (!/^\d+$/.test(contentLength)) {
		throw new ServiceValidationError(['content-length must be a non-negative integer']);
	}
	if (BigInt(contentLength) > BigInt(maxBytes)) {
		throw new ServicePayloadTooLargeError(
			`request exceeds the ${formatBytes(displayMaxBytes)} upload limit`
		);
	}
}

export function multipartUploadBodyLimit(maxFileBytes: number): number {
	return maxFileBytes + MULTIPART_UPLOAD_ENVELOPE_MAX_BYTES;
}

export function serviceJson(error: unknown): Response {
	const status = getStatus(error);
	const message = error instanceof Error ? error.message : 'Unexpected error';
	const issues = isIssueError(error) ? error.issues : undefined;
	const code = readString(error, 'code');
	const category = readString(error, 'category');
	const details = readRecord(error, 'details');

	return json({ error: message, issues, code, category, details }, { status });
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

function readString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === 'string' ? field : undefined;
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return isRecord(field) ? field : undefined;
}

function requestWithMultipartBodyLimit(
	request: Request,
	maxBodyBytes: number,
	displayMaxBytes: number
): Request {
	if (!request.body) return request;

	let bytesRead = 0;
	const limiter = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			bytesRead += chunk.byteLength;
			if (bytesRead > maxBodyBytes) {
				controller.error(
					new ServicePayloadTooLargeError(
						`request exceeds the ${formatBytes(displayMaxBytes)} upload limit`
					)
				);
				return;
			}
			controller.enqueue(chunk);
		}
	});

	return new Request(request, {
		body: request.body.pipeThrough(limiter),
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
}

function formatBytes(bytes: number): string {
	const mib = bytes / 1024 / 1024;
	return Number.isInteger(mib) ? `${mib} MiB` : `${bytes} bytes`;
}
