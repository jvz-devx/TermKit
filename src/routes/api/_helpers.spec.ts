import { describe, expect, it, vi } from 'vitest';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import {
	assertContentLength,
	multipartUploadBodyLimit,
	readJsonObject,
	readRequiredFormFile,
	requireParam,
	requireUser,
	serviceJson
} from './_helpers';

describe('API request helpers', () => {
	it('returns the signed-in user id and rejects missing route auth', () => {
		expect(
			requireUser({ locals: { user: { id: 'user-1' } } } as Parameters<typeof requireUser>[0])
		).toBe('user-1');
		let error: unknown;
		try {
			requireUser({ locals: {} } as Parameters<typeof requireUser>[0]);
		} catch (caught) {
			error = caught;
		}
		expect(error).toMatchObject({
			status: 401,
			message: 'Unauthenticated'
		});
	});

	it('requires path params before route handlers reach services', () => {
		expect(requireParam('host-1', 'hostId')).toBe('host-1');
		expect(() => requireParam(undefined, 'hostId')).toThrow('Missing route parameter: hostId');
	});

	it('normalizes malformed JSON bodies to empty input objects', async () => {
		await expect(
			readJsonObject(
				new Request('https://termix.test/api/hosts', {
					method: 'POST',
					body: 'not-json',
					headers: { 'content-type': 'application/json' }
				})
			)
		).resolves.toEqual({});
	});

	it('rejects oversized requests before parsing multipart bodies', async () => {
		expect.assertions(2);
		const request = new Request('https://termix.test/upload', {
			method: 'POST',
			headers: { 'content-length': String(multipartUploadBodyLimit(100) + 1) }
		});
		const formData = vi.spyOn(request, 'formData');

		await expect(readRequiredFormFile(request, 'file', 100)).rejects.toBeInstanceOf(
			ServicePayloadTooLargeError
		);
		expect(formData).not.toHaveBeenCalled();
	});

	it('rejects malformed content-length values before parsing multipart bodies', () => {
		expect.assertions(2);
		const request = new Request('https://termix.test/upload', {
			method: 'POST',
			headers: { 'content-length': '10, 11' }
		});
		const formData = vi.spyOn(request, 'formData');

		expect(() => assertContentLength(request, 100)).toThrow(ServiceValidationError);
		expect(formData).not.toHaveBeenCalled();
	});

	it('bounds missing content-length requests while multipart data is read', async () => {
		expect.assertions(1);
		const request = multipartRequest({
			body: multipartBody('file', 'upload.txt', '0123456789abcdef'),
			boundary: 'termix-test-boundary'
		});

		await expect(
			readRequiredFormFile(request, 'file', 100, { maxBodyBytes: 16 })
		).rejects.toBeInstanceOf(ServicePayloadTooLargeError);
	});

	it('accepts multipart files without content-length when the bounded body is within limits', async () => {
		const form = new FormData();
		form.set('file', new File(['ok'], 'example.txt'));
		const request = new Request('https://termix.test/upload', {
			method: 'POST',
			body: form
		});

		const file = await readRequiredFormFile(request, 'file', 4);

		expect(file.name).toBe('example.txt');
		expect(file.size).toBe(2);
	});

	it('serializes upload limit failures as 413 responses', async () => {
		expect.assertions(2);
		const response = serviceJson(
			new ServicePayloadTooLargeError('request exceeds the 50 MiB upload limit')
		);
		const body = (await response.json()) as { error: string };

		expect(response.status).toBe(413);
		expect(body.error).toContain('50 MiB');
	});

	it('serializes policy-blocked API states with stable machine-readable fields', async () => {
		const response = serviceJson(
			Object.assign(new Error('Launch sessions is disabled by workspace policy.'), {
				status: 403,
				code: 'policy_action_disabled',
				category: 'authorization',
				details: { action: 'launch', state: 'blocked' },
				issues: ['Launch sessions is disabled by workspace policy.']
			})
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: 'Launch sessions is disabled by workspace policy.',
			issues: ['Launch sessions is disabled by workspace policy.'],
			code: 'policy_action_disabled',
			category: 'authorization',
			details: { action: 'launch', state: 'blocked' }
		});
	});

	it('rejects files larger than the route limit', async () => {
		expect.assertions(1);
		const form = new FormData();
		form.set('file', new File(['abcdef'], 'example.txt'));

		await expect(
			readRequiredFormFile(
				new Request('https://termix.test/upload', { method: 'POST', body: form }),
				'file',
				4
			)
		).rejects.toBeInstanceOf(ServicePayloadTooLargeError);
	});

	it('reports missing multipart files as validation errors', async () => {
		expect.assertions(1);
		const form = new FormData();

		await expect(
			readRequiredFormFile(
				new Request('https://termix.test/upload', { method: 'POST', body: form }),
				'file',
				4
			)
		).rejects.toBeInstanceOf(ServiceValidationError);
	});

	it('adds a bounded multipart envelope allowance to route file limits', () => {
		expect(multipartUploadBodyLimit(1024)).toBe(1024 + 64 * 1024);
	});
});

function multipartRequest(input: { body: string; boundary: string }): Request {
	return new Request('https://termix.test/upload', {
		method: 'POST',
		body: streamFromText(input.body),
		headers: { 'content-type': `multipart/form-data; boundary=${input.boundary}` },
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
}

function multipartBody(field: string, filename: string, contents: string): string {
	return [
		'--termix-test-boundary',
		`Content-Disposition: form-data; name="${field}"; filename="${filename}"`,
		'Content-Type: application/octet-stream',
		'',
		contents,
		'--termix-test-boundary--',
		''
	].join('\r\n');
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});
}
