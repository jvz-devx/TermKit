import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const node = process.execPath;
const root = process.cwd();
const cleanupPaths: string[] = [];

describe('acceptance proof scripts', () => {
	afterEach(() => {
		for (const path of cleanupPaths.splice(0)) {
			rmSync(path, { force: true, recursive: true });
		}
	});

	it('preflights Microsoft interactive proof without generating satisfiable template notes', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const notesPath = join(directory, 'notes.txt');
		const result = runNodeScript(
			['scripts/microsoft-interactive-preflight.mjs', '--notes-template', notesPath],
			{
				MICROSOFT_AUTH_ENABLED: '1',
				MICROSOFT_TENANT_ID: '12345678-1234-4234-9234-123456789abc',
				MICROSOFT_CLIENT_ID: '00000000-0000-4000-8000-000000000000',
				MICROSOFT_CLIENT_SECRET: 'dummy-client-secret-not-real',
				MICROSOFT_ALLOWED_DOMAINS: 'example.com',
				MICROSOFT_ADMIN_EMAILS: 'admin@example.com',
				MICROSOFT_SCOPES: 'openid profile email',
				ORIGIN: 'http://localhost:3000'
			}
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Microsoft interactive acceptance preflight is ready.');
		expect(result.stdout).not.toContain('dummy-client-secret-not-real');
		expect(existsSync(notesPath)).toBe(true);

		const notes = readFileSync(notesPath, 'utf8');
		expect(notes).toContain('TODO');
		expect(notes).not.toContain('allowed-domain');
		expect(notes).not.toContain('blocked-domain');
		expect(notes).not.toContain('admin-email');
		expect(notes).not.toContain('local login');
	});

	it('rejects Microsoft interactive preflight when scopes omit openid', () => {
		expect.hasAssertions();
		const result = runNodeScript(['scripts/microsoft-interactive-preflight.mjs'], {
			MICROSOFT_AUTH_ENABLED: '1',
			MICROSOFT_TENANT_ID: '12345678-1234-4234-9234-123456789abc',
			MICROSOFT_CLIENT_ID: '00000000-0000-4000-8000-000000000000',
			MICROSOFT_CLIENT_SECRET: 'dummy-client-secret-not-real',
			MICROSOFT_ALLOWED_DOMAINS: 'example.com',
			MICROSOFT_ADMIN_EMAILS: 'admin@example.com',
			MICROSOFT_SCOPES: 'profile email',
			ORIGIN: 'http://localhost:3000'
		});

		expect(result.status).toBe(2);
		expect(result.stderr).toContain('MICROSOFT_SCOPES must include openid');
	});

	it('rejects placeholder Microsoft interactive proof notes', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeProofFile(directory);
		const result = runNodeScript(['scripts/record-microsoft-interactive-proof.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_MICROSOFT_INTERACTIVE_NOTES:
				'allowed-domain: TODO; blocked-domain: TODO; admin-email: TODO; local login: TODO'
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('TODO marker');
	});

	it('records redacted Microsoft interactive proof notes', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeProofFile(directory);
		const result = runNodeScript(['scripts/record-microsoft-interactive-proof.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_MICROSOFT_INTERACTIVE_NOTES:
				'allowed-domain: redacted approved user received a TermixKit session; blocked-domain: redacted outside user was denied; admin-email: redacted configured admin became admin; local login: redacted password login still works'
		});

		expect(result.status).toBe(0);
		const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
		expect(proof.proofs.microsoftInteractive.passed).toBe(true);
	});

	it('imports Microsoft smoke artifacts only into current proof files', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const artifactPath = join(directory, 'artifact.json');
		const proofPath = writeProofFile(directory);
		const staleProofPath = join(directory, 'stale-proof.json');
		const microsoftSmoke = {
			passed: true,
			timestamp: '2026-05-14T00:00:00.000Z',
			command: 'TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1 npm run smoke:microsoft',
			redactedEnv: [
				'MICROSOFT_AUTH_ENABLED',
				'MICROSOFT_TENANT_ID',
				'MICROSOFT_CLIENT_ID',
				'MICROSOFT_CLIENT_SECRET',
				'MICROSOFT_ALLOWED_DOMAINS',
				'MICROSOFT_ADMIN_EMAILS'
			],
			output:
				'[pass] Microsoft Entra discovery and JWKS - loaded Microsoft discovery and 3 JWKS keys'
		};

		writeFileSync(
			artifactPath,
			`${JSON.stringify({ commit: currentCommit(), generatedAt: microsoftSmoke.timestamp, proofs: { microsoftSmoke } }, null, 2)}\n`
		);
		writeFileSync(
			staleProofPath,
			`${JSON.stringify({ commit: 'old', generatedAt: microsoftSmoke.timestamp, proofs: { microsoftInteractive: { passed: true } } }, null, 2)}\n`
		);

		const importResult = runNodeScript(
			[
				'scripts/import-microsoft-smoke-proof.mjs',
				'--artifact',
				artifactPath,
				'--proof',
				proofPath
			],
			{}
		);
		expect(importResult.status).toBe(0);
		const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
		expect(proof.proofs.microsoftSmoke.passed).toBe(true);

		const staleResult = runNodeScript(
			[
				'scripts/import-microsoft-smoke-proof.mjs',
				'--artifact',
				artifactPath,
				'--proof',
				staleProofPath
			],
			{}
		);
		expect(staleResult.status).toBe(1);
		expect(staleResult.stderr).toContain('Refusing to re-stamp existing proofs');
	});
});

function runNodeScript(args: string[], env: NodeJS.ProcessEnv) {
	return spawnSync(node, args, {
		cwd: root,
		encoding: 'utf8',
		env: {
			HOME: process.env.HOME,
			PATH: process.env.PATH,
			TMPDIR: process.env.TMPDIR,
			...env
		}
	});
}

function tempDirectory() {
	const directory = mkdtempSync(join(tmpdir(), 'termixkit-proof-scripts-'));
	cleanupPaths.push(directory);
	return directory;
}

function writeProofFile(directory: string) {
	const proofPath = join(directory, 'acceptance-proof.local.json');
	writeFileSync(
		proofPath,
		`${JSON.stringify({ commit: currentCommit(), generatedAt: '2026-05-14T00:00:00.000Z', proofs: {} }, null, 2)}\n`
	);
	return proofPath;
}

function currentCommit() {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
