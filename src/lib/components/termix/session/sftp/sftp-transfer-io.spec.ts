import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDownloadBlob, saveDownloadedBlob } from './sftp-transfer-io';
import type { RemoteEntry } from './file-manager-state';

describe('SFTP transfer IO helpers', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches a non-streaming download blob and reports progress', async () => {
		const blob = new Blob(['hello']);
		const progress = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(blob, { headers: { 'content-type': 'text/plain' } }))
		);

		const result = await fetchDownloadBlob(
			entry(),
			'/download',
			new AbortController().signal,
			progress
		);

		expect(await result.text()).toBe('hello');
		expect(progress).toHaveBeenCalledWith(5);
	});

	it('turns failed download responses into API errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"error":"Denied"}', { status: 403 }))
		);

		await expect(
			fetchDownloadBlob(entry(), '/download', new AbortController().signal, vi.fn())
		).rejects.toThrow('Denied');
	});

	it('saves blobs through a temporary anchor', () => {
		const click = vi.fn();
		const append = vi.fn();
		const anchor = {
			click,
			remove: vi.fn(),
			set href(value: string) {
				this.hrefValue = value;
			},
			get href() {
				return this.hrefValue;
			},
			hrefValue: '',
			download: '',
			rel: ''
		};
		vi.stubGlobal('document', {
			createElement: vi.fn(() => anchor),
			body: { append }
		});
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

		saveDownloadedBlob(entry({ name: 'download.txt' }), new Blob(['hello']));

		expect(anchor.href).toBe('blob:url');
		expect(anchor.download).toBe('download.txt');
		expect(click).toHaveBeenCalledOnce();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url');
	});
});

function entry(overrides: Partial<RemoteEntry> = {}): RemoteEntry {
	return {
		name: 'file.txt',
		path: '/file.txt',
		type: 'file',
		size: 5,
		mtime: null,
		...overrides
	};
}
