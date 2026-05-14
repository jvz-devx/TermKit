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

function routeEvent(request: Request, authenticated = true) {
	return {
		request,
		locals: authenticated ? { user: { id: 'user-1' } } : {}
	} as Parameters<typeof validatePost>[0];
}
