import { describe, expect, it } from 'vitest';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import { assertContentLength, readRequiredFormFile, serviceJson } from './_helpers';

describe('API request helpers', () => {
	it('rejects oversized requests before parsing multipart bodies', async () => {
		expect.assertions(1);
		const request = new Request('https://termix.test/upload', {
			method: 'POST',
			headers: { 'content-length': '1024' }
		});

		await expect(readRequiredFormFile(request, 'file', 100)).rejects.toBeInstanceOf(
			ServicePayloadTooLargeError
		);
	});

	it('rejects malformed content-length values before parsing multipart bodies', () => {
		expect.assertions(1);
		const request = new Request('https://termix.test/upload', {
			method: 'POST',
			headers: { 'content-length': '10, 11' }
		});

		expect(() => assertContentLength(request, 100)).toThrow(ServiceValidationError);
	});

	it('allows missing content-length so streaming and parsed file limits can enforce the cap', () => {
		const request = new Request('https://termix.test/upload', {
			method: 'POST'
		});

		expect(() => assertContentLength(request, 100)).not.toThrow();
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
});
