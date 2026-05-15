import packageJson from '../../package.json';

export type AppBuildInfo = {
	name: string;
	packageVersion: string;
	commitSha: string;
	shortCommitSha: string;
	buildDate: string;
	environment: 'development' | 'production';
	displayVersion: string;
};

type AppBuildInfoInput = {
	packageVersion?: unknown;
	commitSha?: unknown;
	shortCommitSha?: unknown;
	buildDate?: unknown;
};

export const appBuildInfo = createAppBuildInfo({
	packageVersion: import.meta.env.PUBLIC_TERMIXKIT_PACKAGE_VERSION || packageJson.version,
	commitSha: import.meta.env.PUBLIC_TERMIXKIT_COMMIT_SHA,
	shortCommitSha: import.meta.env.PUBLIC_TERMIXKIT_SHORT_SHA,
	buildDate: import.meta.env.PUBLIC_TERMIXKIT_BUILD_DATE
});

export function createAppBuildInfo(input: AppBuildInfoInput = {}): AppBuildInfo {
	const packageVersion = clean(input.packageVersion) ?? '0.0.0';
	const commitSha = clean(input.commitSha) ?? 'dev';
	const shortCommitSha = clean(input.shortCommitSha) ?? deriveShortCommitSha(commitSha);
	const buildDate = clean(input.buildDate) ?? 'local development';
	const environment = commitSha === 'dev' ? 'development' : 'production';

	return {
		name: 'TermixKit',
		packageVersion,
		commitSha,
		shortCommitSha,
		buildDate,
		environment,
		displayVersion:
			environment === 'development'
				? `dev (${packageVersion})`
				: `${shortCommitSha} (${packageVersion})`
	};
}

function deriveShortCommitSha(commitSha: string) {
	return commitSha === 'dev' ? 'dev' : commitSha.slice(0, 12);
}

function clean(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}
