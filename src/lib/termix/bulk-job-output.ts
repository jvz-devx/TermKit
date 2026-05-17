import type { BulkCapturedOutput, BulkOutputPolicy } from './bulk-jobs';

export const defaultMaxOutputBytes = 64 * 1024;
export const secretKeyPattern =
	/(password|passwd|passphrase|secret|token|api[_-]?key|private[_-]?key)/i;

export function captureBulkOutput(
	value: string | Buffer | null | undefined,
	policy: BulkOutputPolicy
): BulkCapturedOutput {
	const source = Buffer.isBuffer(value) ? value.toString('utf8') : (value ?? '');
	const originalBytes = Buffer.byteLength(source, 'utf8');
	const redacted = redactText(source, policy.redactionValues);
	const redactedBytes = Buffer.byteLength(redacted.text, 'utf8');
	if (redactedBytes <= policy.maxBytes) {
		return {
			text: redacted.text,
			originalBytes,
			truncated: false,
			redacted: redacted.redacted
		};
	}

	return {
		text: truncateUtf8(redacted.text, policy.maxBytes),
		originalBytes,
		truncated: true,
		redacted: redacted.redacted
	};
}

export function redactText(text: string, values: string[]): { text: string; redacted: boolean } {
	let redacted = text;
	for (const value of values) {
		redacted = redacted.split(value).join('[REDACTED]');
	}
	redacted = redacted
		.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
		.replace(
			/(password|passwd|passphrase|secret|token|api[_-]?key)\s*[:=]\s*([^\s,;"']+)/gi,
			'$1=[REDACTED]'
		)
		.replace(
			/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,
			'[REDACTED PRIVATE KEY]'
		);
	return { text: redacted, redacted: redacted !== text };
}

export function sanitizeReportFields(
	fields: Record<string, string | number | boolean | null>,
	redactionValues: string[]
): Record<string, string | number | boolean | null> {
	const sanitized: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (secretKeyPattern.test(key)) continue;
		if (typeof value === 'string') sanitized[key] = redactText(value, redactionValues).text;
		else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
			sanitized[key] = value;
		}
	}
	return sanitized;
}

function truncateUtf8(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, 'utf8');
	return (
		buffer
			.subarray(0, maxBytes)
			.toString('utf8')
			.replace(/\uFFFD$/, '') + '\n[truncated]'
	);
}
