#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightBin = resolve(root, 'node_modules/.bin/playwright');
const browserCandidates = ['chromium', 'google-chrome', 'google-chrome-stable'];

const env = { ...process.env };
if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
	const browserPath = browserCandidates.map(commandPath).find(Boolean);
	if (browserPath) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = browserPath;
}

const child = spawn(playwrightBin, ['test', ...process.argv.slice(2)], {
	cwd: root,
	env,
	stdio: 'inherit'
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 1);
});

function commandPath(name) {
	if (existsSync(name)) return name;

	const result = spawnSync('sh', ['-lc', `command -v ${name}`], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	});

	const path = result.stdout.trim();
	return result.status === 0 && path ? path : null;
}
