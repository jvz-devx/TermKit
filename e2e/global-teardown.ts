import { execFile as execFileCallback } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { playwrightStatePath } from '../scripts/playwright-state.mjs';

const execFile = promisify(execFileCallback);

export default async function globalTeardown() {
	const statePath = playwrightStatePath(process.cwd());
	let containerName: string | undefined;

	try {
		const state = JSON.parse(await readFile(statePath, 'utf8')) as { containerName?: unknown };
		if (typeof state.containerName === 'string') containerName = state.containerName;
	} catch {
		return;
	}

	if (containerName) {
		try {
			await execFile('docker', ['stop', '--timeout', '5', containerName]);
		} catch {
			// The web server helper may have already stopped the container.
		}
	}

	await rm(statePath, { force: true });
}
