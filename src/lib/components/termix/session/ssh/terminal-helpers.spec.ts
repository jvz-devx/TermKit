import { describe, expect, it } from 'vitest';
import { nextCommandHistory, updateCommandDraft } from './terminal-helpers';

describe('terminal helper state', () => {
	it('tracks typed command history without reading terminal output', () => {
		let draft = updateCommandDraft('', 'ls -la');
		expect(draft).toBe('ls -la');

		const history = nextCommandHistory([], draft);
		draft = updateCommandDraft(draft, '\r');

		expect(draft).toBe('');
		expect(history).toEqual(['ls -la']);
	});

	it('deduplicates local commands and supports backspace/control-c', () => {
		const history = nextCommandHistory(['pwd', 'whoami'], 'pwd');

		expect(history).toEqual(['pwd', 'whoami']);
		expect(updateCommandDraft('abcdef', '\u007f\u007f')).toBe('abcd');
		expect(updateCommandDraft('sudo', '\u0003')).toBe('');
	});
});
