import { describe, expect, it } from 'vitest';
import { saveTextRequest } from './sftp-text-editor.svelte';

describe('SFTP text editor helpers', () => {
	it('builds the text save request body', () => {
		expect(saveTextRequest('/workspace/readme.md', 'hello')).toEqual({
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: '/workspace/readme.md', text: 'hello' })
		});
	});
});
