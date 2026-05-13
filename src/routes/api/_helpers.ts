import { json, type RequestEvent } from '@sveltejs/kit';
import { ServiceUnauthorizedError } from '$lib/server/services/errors';

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
