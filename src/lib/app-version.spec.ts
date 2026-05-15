import { describe, expect, it } from 'vitest';
import { createAppBuildInfo } from './app-version';

describe('app build info', () => {
	it('formats production build metadata from GitHub image inputs', () => {
		expect(
			createAppBuildInfo({
				packageVersion: '1.2.3',
				commitSha: '1234567890abcdef',
				shortCommitSha: '1234567890ab',
				buildDate: '2026-05-15T12:00:00Z'
			})
		).toEqual({
			name: 'TermixKit',
			packageVersion: '1.2.3',
			commitSha: '1234567890abcdef',
			shortCommitSha: '1234567890ab',
			buildDate: '2026-05-15T12:00:00Z',
			environment: 'production',
			displayVersion: '1234567890ab (1.2.3)'
		});
	});

	it('falls back to local development metadata when build inputs are absent', () => {
		expect(createAppBuildInfo({ packageVersion: '1.2.3' })).toEqual({
			name: 'TermixKit',
			packageVersion: '1.2.3',
			commitSha: 'dev',
			shortCommitSha: 'dev',
			buildDate: 'unknown',
			environment: 'development',
			displayVersion: 'dev (1.2.3)'
		});
	});

	it('derives the short commit when only the full commit is provided', () => {
		expect(
			createAppBuildInfo({
				packageVersion: '1.2.3',
				commitSha: 'abcdef1234567890'
			}).shortCommitSha
		).toBe('abcdef123456');
	});
});
