import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('utils', () => {
	it('combines conditional class names and merges Tailwind conflicts', () => {
		expect(cn('px-2', { hidden: false, block: true }, ['py-1', 'px-4'])).toBe('block py-1 px-4');
	});
});
