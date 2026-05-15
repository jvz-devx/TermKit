import { describe, expect, it } from 'vitest';
import { ServicePayloadTooLargeError, ServiceValidationError } from '$lib/server/services/errors';
import {
	assertContentLength,
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
});
