export type ApiResponseBody = Record<string, unknown>;

export async function readApiBody(response: Response, fallback: string): Promise<ApiResponseBody> {
	const responseText = await response.text().catch(() => '');
	const body = parseApiResponseBody(responseText);
	if (body) return body;
	if (!response.ok) throw new Error(responseError(responseText, fallback));
	return {};
}

export function apiErrorMessage(body: ApiResponseBody, fallback: string) {
	if (typeof body.error === 'string' && body.error.trim()) return body.error;
	if (Array.isArray(body.issues)) {
		const issues = body.issues.filter((issue): issue is string => typeof issue === 'string');
		if (issues.length) return issues.join('; ');
	}
	return fallback;
}

export function responseError(responseText: string, fallback: string) {
	const body = parseApiResponseBody(responseText);
	if (body) return apiErrorMessage(body, fallback);
	const plainText = compactResponseText(responseText);
	return plainText ? `${fallback}: ${plainText}` : fallback;
}

export function parseApiResponseBody(responseText: string): ApiResponseBody | null {
	try {
		const body = JSON.parse(responseText);
		return typeof body === 'object' && body !== null && !Array.isArray(body) ? body : null;
	} catch {
		return null;
	}
}

export function compactResponseText(responseText: string) {
	const compact = responseText.replace(/\s+/g, ' ').trim();
	return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}
