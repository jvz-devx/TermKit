export type TerminalSnippet = {
	id: string;
	label: string;
	command: string;
};

export const terminalSnippets: TerminalSnippet[] = [
	{ id: 'pwd', label: 'pwd', command: 'pwd' },
	{ id: 'ls', label: 'ls -la', command: 'ls -la' },
	{ id: 'whoami', label: 'whoami', command: 'whoami' },
	{ id: 'disk', label: 'df -h', command: 'df -h' }
];

export function updateCommandDraft(draft: string, input: string): string {
	let next = draft;
	for (const char of input) {
		if (char === '\r' || char === '\n') return '';
		if (char === '\u0003') return '';
		if (char === '\u007f' || char === '\b') {
			next = next.slice(0, -1);
			continue;
		}
		if (char >= ' ' && char !== '\u007f') next += char;
	}
	return next;
}

export function nextCommandHistory(history: string[], draft: string, limit = 12): string[] {
	const command = draft.trim();
	if (!command) return history;
	const withoutDuplicate = history.filter((entry) => entry !== command);
	return [command, ...withoutDuplicate].slice(0, limit);
}
