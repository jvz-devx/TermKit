import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function playwrightStatePath(root = process.cwd()) {
	const digest = createHash('sha256').update(root).digest('hex').slice(0, 16);
	return join(tmpdir(), `termixkit-playwright-${digest}.json`);
}
