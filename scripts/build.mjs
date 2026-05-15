import { spawnSync } from 'node:child_process';

const env = { ...process.env };

applyBuildMetadata(env);
run('vite', ['build'], env);
run('npm', ['run', 'build:server'], env);

function applyBuildMetadata(targetEnv) {
	const commitSha = clean(targetEnv.PUBLIC_TERMIXKIT_COMMIT_SHA) ?? git(['rev-parse', 'HEAD']);
	if (commitSha) {
		targetEnv.PUBLIC_TERMIXKIT_COMMIT_SHA = commitSha;
		targetEnv.PUBLIC_TERMIXKIT_SHORT_SHA =
			clean(targetEnv.PUBLIC_TERMIXKIT_SHORT_SHA) ?? commitSha.slice(0, 12);
	} else {
		targetEnv.PUBLIC_TERMIXKIT_COMMIT_SHA = clean(targetEnv.PUBLIC_TERMIXKIT_COMMIT_SHA) ?? 'dev';
		targetEnv.PUBLIC_TERMIXKIT_SHORT_SHA = clean(targetEnv.PUBLIC_TERMIXKIT_SHORT_SHA) ?? 'dev';
	}

	targetEnv.PUBLIC_TERMIXKIT_BUILD_DATE =
		clean(targetEnv.PUBLIC_TERMIXKIT_BUILD_DATE) ?? new Date().toISOString();
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

function clean(value) {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
