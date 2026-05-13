import { describe, expect, it, vi } from 'vitest';
import { importService } from '$lib/server/import/service';
import { POST as importPost } from './jobs/+server';
import { POST as validatePost } from './validate/+server';

vi.mock('$lib/server/import/service', () => ({
	importService: {
		validate: vi.fn(async () => ({ job: { id: 'validate-job' }, preview: {} })),
		import: vi.fn(async () => ({ job: { id: 'import-job' }, preview: {} })),
		listJobs: vi.fn()
	}
}));

describe('import API routes', () => {
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
});

function formRequest(path: string, sourceSecret: string): Request {
	const form = new FormData();
	form.set('file', new File(['[]'], 'termix.json', { type: 'application/json' }));
	form.set('sourceSecret', sourceSecret);
	return new Request(`https://termix.test${path}`, { method: 'POST', body: form });
}

function routeEvent(request: Request) {
	return {
		request,
		locals: { user: { id: 'user-1' } }
	} as Parameters<typeof validatePost>[0];
}
