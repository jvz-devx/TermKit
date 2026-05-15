import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importService } from '$lib/server/import/service';
import { GET as jobsGet, POST as importPost } from './jobs/+server';
import { POST as validatePost } from './validate/+server';

vi.mock('$lib/server/import/service', () => ({
	importService: {
		validate: vi.fn(async () => ({ job: { id: 'validate-job' }, preview: {} })),
		import: vi.fn(async () => ({ job: { id: 'import-job' }, preview: {} })),
		listJobs: vi.fn()
	}
}));

describe('import API routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('passes sourceSecret through validation uploads', async () => {
		const request = formRequest('/api/import/validate', 'validate-secret');

		await validatePost(routeEvent(request));

		expect(importService.validate).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				fileName: 'termix.json',
				sourceSecret: 'validate-secret'
			})
		);
	});

	it('passes sourceSecret through import uploads', async () => {
		const request = formRequest('/api/import/jobs', 'import-secret');

		await importPost(routeEvent(request));

		expect(importService.import).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				fileName: 'termix.json',
				sourceSecret: 'import-secret'
			})
		);
	});

	it('rejects unauthenticated import validation and job requests', async () => {
		const validateResponse = await validatePost(
			routeEvent(formRequest('/api/import/validate', 'validate-secret'), false)
		);
		const jobsResponse = await jobsGet(
			routeEvent(new Request('https://termix.test/api/import/jobs'), false)
		);

		expect(validateResponse.status).toBe(401);
		expect(await validateResponse.json()).toMatchObject({ error: 'Unauthenticated' });
		expect(jobsResponse.status).toBe(401);
		expect(await jobsResponse.json()).toMatchObject({ error: 'Unauthenticated' });
		expect(importService.validate).not.toHaveBeenCalled();
		expect(importService.listJobs).not.toHaveBeenCalled();
	});

	it('rejects oversized import uploads from content-length before parsing multipart bodies', async () => {
		const response = await validatePost(
			routeEvent(
				new Request('https://termix.test/api/import/validate', {
					method: 'POST',
					headers: { 'content-length': String(11 * 1024 * 1024) }
				})
			)
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toMatchObject({
			error: 'request exceeds the 10 MiB upload limit'
		});
		expect(importService.validate).not.toHaveBeenCalled();
	});

	it('rejects import validation uploads with dishonest small content-length while streaming', async () => {
		const response = await validatePost(
			routeEvent(
				oversizedStreamingImportRequest('/api/import/validate', {
					contentLength: '1'
				})
			)
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toMatchObject({
			error: 'request exceeds the 10 MiB upload limit'
		});
		expect(importService.validate).not.toHaveBeenCalled();
	});

	it('rejects import job uploads with missing content-length while streaming over the limit', async () => {
		const response = await importPost(
			routeEvent(oversizedStreamingImportRequest('/api/import/jobs'))
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toMatchObject({
			error: 'request exceeds the 10 MiB upload limit'
		});
		expect(importService.import).not.toHaveBeenCalled();
	});

	it('rejects malformed content-length on import uploads before service access', async () => {
		const response = await importPost(
			routeEvent(
				new Request('https://termix.test/api/import/jobs', {
					method: 'POST',
					headers: { 'content-length': '10, 11' }
				})
			)
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			issues: ['content-length must be a non-negative integer']
		});
		expect(importService.import).not.toHaveBeenCalled();
	});

	it('rejects import job uploads without files before service access', async () => {
		const form = new FormData();
		form.set('sourceSecret', 'import-secret');

		const response = await importPost(
			routeEvent(
				new Request('https://termix.test/api/import/jobs', {
					method: 'POST',
					body: form
				})
			)
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ issues: ['file is required'] });
		expect(importService.import).not.toHaveBeenCalled();
	});

	it('serializes policy-blocked import jobs with stable fields', async () => {
		vi.mocked(importService.import).mockRejectedValueOnce(
			Object.assign(new Error('Bulk import jobs are disabled by workspace policy.'), {
				status: 403,
				code: 'policy_action_disabled',
				category: 'authorization',
				details: { action: 'bulkJobs', state: 'blocked' }
			}) as never
		);

		const response = await importPost(routeEvent(formRequest('/api/import/jobs', 'import-secret')));

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: 'Bulk import jobs are disabled by workspace policy.',
			code: 'policy_action_disabled',
			category: 'authorization',
			details: { action: 'bulkJobs', state: 'blocked' }
		});
	});

	it('lists persisted import jobs for the signed-in user', async () => {
		vi.mocked(importService.listJobs).mockResolvedValueOnce([
			{
				id: 'job-1',
				sourceName: 'termix.json',
				status: 'validated'
			}
		] as never);

		const response = await jobsGet(routeEvent(new Request('https://termix.test/api/import/jobs')));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			jobs: [{ id: 'job-1', sourceName: 'termix.json', status: 'validated' }]
		});
		expect(importService.listJobs).toHaveBeenCalledWith('user-1');
	});
});

function formRequest(path: string, sourceSecret: string): Request {
	const form = new FormData();
	form.set('file', new File(['[]'], 'termix.json', { type: 'application/json' }));
	form.set('sourceSecret', sourceSecret);
	return new Request(`https://termix.test${path}`, { method: 'POST', body: form });
}

function oversizedStreamingImportRequest(
	path: string,
	options: { contentLength?: string } = {}
): Request {
	const boundary = 'termix-import-boundary';
	const fileContents = 'x'.repeat(10 * 1024 * 1024 + 128 * 1024);
	const body = [
		`--${boundary}`,
		'Content-Disposition: form-data; name="file"; filename="termix.json"',
		'Content-Type: application/json',
		'',
		fileContents,
		`--${boundary}--`,
		''
	].join('\r\n');
	const headers = new Headers({ 'content-type': `multipart/form-data; boundary=${boundary}` });
	if (options.contentLength) headers.set('content-length', options.contentLength);
	return new Request(`https://termix.test${path}`, {
		method: 'POST',
		body: streamFromText(body),
		headers,
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});
}

function routeEvent(request: Request, authenticated = true) {
	return {
		request,
		locals: authenticated ? { user: { id: 'user-1' } } : {}
	} as Parameters<typeof validatePost>[0];
}
