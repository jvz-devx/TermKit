import { describe, expect, it } from 'vitest';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import { readRequiredFormFile } from './_helpers';

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
