import { describe, expect, it } from 'vitest';
import {
	apiErrorMessage,
	compactResponseText,
	parseApiResponseBody,
	readApiBody,
	responseError
} from './sftp-api-response';

describe('SFTP API response helpers', () => {
	it('parses object JSON responses only', () => {
		expect(parseApiResponseBody('{"ok":true}')).toEqual({ ok: true });
		expect(parseApiResponseBody('["not", "object"]')).toBeNull();
		expect(parseApiResponseBody('not json')).toBeNull();
	});

	it('prefers structured API errors and issues', () => {
		expect(apiErrorMessage({ error: 'Permission denied' }, 'Fallback')).toBe('Permission denied');
		expect(apiErrorMessage({ issues: ['One', 2, 'Two'] }, 'Fallback')).toBe('One; Two');
		expect(apiErrorMessage({}, 'Fallback')).toBe('Fallback');
	});

	it('compacts plain-text response errors', () => {
		expect(responseError('  plain\n\ttext  ', 'Failed')).toBe('Failed: plain text');
		expect(responseError('', 'Failed')).toBe('Failed');
		expect(compactResponseText('x'.repeat(260))).toHaveLength(240);
	});

	it('reads successful empty responses as an empty object', async () => {
		const body = await readApiBody(new Response('', { status: 200 }), 'Failed');

		expect(body).toEqual({});
	});

	it('throws plain-text errors for failed non-json responses', async () => {
		await expect(readApiBody(new Response('nope', { status: 500 }), 'Failed')).rejects.toThrow(
			'Failed: nope'
		);
	});
});
