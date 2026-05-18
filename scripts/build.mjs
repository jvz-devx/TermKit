import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = { ...process.env };
const packageVersion = readPackageVersion();

applyBuildMetadata(env);
run('vite', ['build'], env);
run('npm', ['run', 'build:server'], env);

function applyBuildMetadata(targetEnv) {
	const commitSha =
		buildValue(targetEnv.PUBLIC_TERMKIT_COMMIT_SHA, ['dev']) ?? git(['rev-parse', 'HEAD']);
	if (commitSha) {
		targetEnv.PUBLIC_TERMKIT_COMMIT_SHA = commitSha;
		targetEnv.PUBLIC_TERMKIT_SHORT_SHA =
			buildValue(targetEnv.PUBLIC_TERMKIT_SHORT_SHA, ['dev']) ?? commitSha.slice(0, 12);
	} else {
		targetEnv.PUBLIC_TERMKIT_COMMIT_SHA = clean(targetEnv.PUBLIC_TERMKIT_COMMIT_SHA) ?? 'dev';
		targetEnv.PUBLIC_TERMKIT_SHORT_SHA = clean(targetEnv.PUBLIC_TERMKIT_SHORT_SHA) ?? 'dev';
	}

	targetEnv.PUBLIC_TERMKIT_BUILD_DATE =
		buildValue(targetEnv.PUBLIC_TERMKIT_BUILD_DATE, ['unknown']) ?? new Date().toISOString();
	targetEnv.PUBLIC_TERMKIT_PACKAGE_VERSION =
		buildValue(targetEnv.PUBLIC_TERMKIT_PACKAGE_VERSION) ??
		`${packageVersion}+${targetEnv.PUBLIC_TERMKIT_SHORT_SHA}`;
}

function git(args) {
	const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	if (result.status !== 0) return null;
	return clean(result.stdout);
}

function run(command, args, commandEnv) {
	const result = spawnSync(command, args, {
		env: commandEnv,
		stdio: 'inherit'
	});

	if (result.status !== 0) process.exit(result.status ?? 1);
}

function readPackageVersion() {
	const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	return clean(packageJson.version) ?? '0.0.0';
}

function buildValue(value, placeholders = []) {
	const normalized = clean(value);
	if (!normalized) return null;
	return placeholders.includes(normalized.toLowerCase()) ? null : normalized;
}

function clean(value) {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
