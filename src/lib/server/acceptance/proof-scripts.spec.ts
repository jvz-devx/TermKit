import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const node = process.execPath;
const root = process.cwd();
const cleanupPaths: string[] = [];
let proofFileCounter = 0;

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
				'allowed-domain: redacted approved user received a TermixKit session; blocked-domain: redacted outside user was denied; admin-email: redacted configured admin became admin; local login: redacted local credential sign-in still works'
		});

		expect(result.status).toBe(0);
		const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
		expect(proof.proofs.microsoftInteractive.passed).toBe(true);
	});

	it('records redacted real FTP and FTPS proof notes', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeProofFile(directory);
		const ftpResult = runNodeScript(['scripts/record-external-proof.mjs', 'realFtp'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_REAL_FTP_HOST: 'ftp.example.test',
			TERMIXKIT_REAL_FTP_PORT: '21',
			TERMIXKIT_REAL_FTP_USERNAME: 'ftp-operator',
			TERMIXKIT_REAL_FTP_EVIDENCE_ID: 'ftp-proof-ticket-123',
			TERMIXKIT_REAL_FTP_PROOF_NOTES:
				'ftp login verified against a real server; ftp list showed the fixture directory; ftp download matched the fixture file; ftp upload created a redacted file; ftp mkdir created a directory; ftp rename moved the file; ftp delete removed created files; ftp text edit saved redacted content; connection history recorded the session'
		});
		const ftpsResult = runNodeScript(['scripts/record-external-proof.mjs', 'realFtps'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_REAL_FTPS_HOST: 'ftps.example.test',
			TERMIXKIT_REAL_FTPS_PORT: '990',
			TERMIXKIT_REAL_FTPS_USERNAME: 'ftps-operator',
			TERMIXKIT_REAL_FTPS_MODE: 'explicit',
			TERMIXKIT_REAL_FTPS_CERTIFICATE_POLICY: 'verified',
			TERMIXKIT_REAL_FTPS_EVIDENCE_ID: 'ftps-proof-ticket-456',
			TERMIXKIT_REAL_FTPS_PROOF_NOTES:
				'ftps login verified against a real server; ftps tls negotiated successfully; ftps certificate policy was observed; ftps list showed the fixture directory; ftps download matched the fixture file; ftps upload created a redacted file; ftps mkdir created a directory; ftps rename moved the file; ftps delete removed created files; ftps text edit saved redacted content; connection history recorded the session'
		});

		expect(ftpResult.status).toBe(0);
		expect(ftpsResult.status).toBe(0);
		const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
		expect(proof.proofs.realFtp.passed).toBe(true);
		expect(proof.proofs.realFtps.passed).toBe(true);
		expect(proof.proofs.realFtp.evidenceId).toBe('ftp-proof-ticket-123');
		expect(proof.proofs.realFtps.evidenceId).toBe('ftps-proof-ticket-456');
	});

	it('rejects placeholder real FTP proof notes', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeProofFile(directory);
		const result = runNodeScript(['scripts/record-external-proof.mjs', 'realFtp'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_REAL_FTP_HOST: 'ftp.example.test',
			TERMIXKIT_REAL_FTP_PORT: '21',
			TERMIXKIT_REAL_FTP_USERNAME: 'ftp-operator',
			TERMIXKIT_REAL_FTP_EVIDENCE_ID: 'ftp-proof-ticket-123',
			TERMIXKIT_REAL_FTP_PROOF_NOTES:
				'ftp login TODO; ftp list TODO; ftp download TODO; ftp upload TODO; ftp mkdir TODO; ftp rename TODO; ftp delete TODO; ftp text edit TODO; connection history TODO'
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('TODO marker');
	});

	it('requires real FTP target identifiers and rejects env-style secret labels in notes', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeProofFile(directory);
		const notes =
			'ftp login verified against a real server; ftp list showed the fixture directory; ftp download matched the fixture file; ftp upload created a redacted file; ftp mkdir created a directory; ftp rename moved the file; ftp delete removed created files; ftp text edit saved redacted content; connection history recorded the session';

		const missingTargetResult = runNodeScript(['scripts/record-external-proof.mjs', 'realFtp'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_REAL_FTP_PROOF_NOTES: notes
		});
		const secretLabelResult = runNodeScript(['scripts/record-external-proof.mjs', 'realFtp'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_REAL_FTP_HOST: 'ftp.example.test',
			TERMIXKIT_REAL_FTP_PORT: '21',
			TERMIXKIT_REAL_FTP_USERNAME: 'ftp-operator',
			TERMIXKIT_REAL_FTP_EVIDENCE_ID: 'ftp-proof-ticket-123',
			TERMIXKIT_REAL_FTP_PROOF_NOTES: `${notes}; TERMIXKIT_REAL_FTP_PASSWORD=hunter2`
		});

		expect(missingTargetResult.status).toBe(1);
		expect(missingTargetResult.stderr).toContain('TERMIXKIT_REAL_FTP_HOST');
		expect(secretLabelResult.status).toBe(1);
		expect(secretLabelResult.stderr).toContain('env-style secret label');
	});

	it('rejects Microsoft interactive proof notes with password labels', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeProofFile(directory);
		const result = runNodeScript(['scripts/record-microsoft-interactive-proof.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_MICROSOFT_INTERACTIVE_NOTES:
				'allowed-domain: redacted approved user received a TermixKit session; blocked-domain: redacted outside user was denied; admin-email: redacted configured admin became admin; local login: redacted password: hunter2'
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('password label');
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

	it('does not accept environment sentinels as external acceptance proof', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeProofFile(directory);
		const result = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath,
			TERMIXKIT_ACCEPTANCE_REAL_SSH_PASSED: 'not-a-proof',
			TERMIXKIT_ACCEPTANCE_REAL_VNC_PASSED: 'not-a-proof',
			TERMIXKIT_ACCEPTANCE_REAL_RDP_PASSED: 'not-a-proof',
			TERMIXKIT_ACCEPTANCE_MICROSOFT_SMOKE_PASSED: 'not-a-proof',
			TERMIXKIT_SMOKE_MICROSOFT_INTERACTIVE_PROOF: 'not-a-proof'
		});

		expect(result.status).toBe(2);
		expect(result.stdout).toContain('[blocked] V1 real SSH host verification');
		expect(result.stdout).toContain('[external-blocked] V2 Microsoft interactive login acceptance');
	});

	it('includes V5 terminal recording implementation evidence with valid external acceptance proofs', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeAcceptanceProofFile(directory, validAcceptanceProofs());
		const result = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath
		});

		expect(result.status).toBe(2);
		expect(result.stdout).toContain('[local] V4 admin SSH tunnel visibility and termination');
		expect(result.stdout).toContain(
			'[local] V4 admin FTP and FTPS long-running activity visibility'
		);
		expect(result.stdout).toContain(
			'[local] V4 connection history includes ssh_tunnel, ftp, ftps, and structured failure reasons'
		);
		expect(result.stdout).toContain(
			'[local] V5 SSH terminal preferences, snippets, jump hosts, and host-key UX'
		);
		expect(result.stdout).toContain(
			'[local] V5 terminal session recording controls, capture, and retention cleanup'
		);
		expect(result.stdout).toContain(
			'[local] V5 SFTP file-manager bookmarks and transfer power tools'
		);
		expect(result.stdout).toContain(
			'[local] V5 FTP and FTPS mode settings plus runtime TLS behavior'
		);
		expect(result.stdout).toContain('[local] V5 RDP operator controls and host settings');
		expect(result.stdout).toContain(
			'[local] V6 automation templates support typed previews and secret masking'
		);
		expect(result.stdout).toContain(
			'[local] V6 bulk jobs enforce reviewed targets, concurrency, retry, cancellation, and reports'
		);
		expect(result.stdout).toContain('[local] V6 fleet operations UI shell and navigation');
		expectV7Rows(result.stdout);
		expect(result.stdout).toContain(
			'acceptance audit: 2 repo-owned requirement(s) still need implementation or stronger local proof'
		);
	});

	it('keeps V7 acceptance rows aligned with spec, README, and coverage gap docs', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const proofPath = writeAcceptanceProofFile(directory, validAcceptanceProofs());
		const result = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath
		});
		const spec = readFileSync('spec.md', 'utf8');
		const readme = readFileSync('README.md', 'utf8');
		const coverageDocs = readFileSync('docs/coverage-baseline.md', 'utf8');

		expect(result.status).toBe(2);
		expect(v7AuditRows(result.stdout)).toEqual([
			'[local] V7 coverage tooling and baseline reporting',
			'[local] V7 server and security regression foundation',
			'[local] V7 fleet wiring and browser workflow foundation',
			'[local] V7 coverage ratchet threshold foundation',
			'[pending] V7 final coverage target achievement',
			'[local] V7 full workflow and protocol browser coverage',
			'[local] V7 reliability and performance budget foundation',
			'[pending] V7 final reliability and performance budgets',
			'[proof-ready] V7 real FTP external proof',
			'[proof-ready] V7 real FTPS external proof'
		]);
		expect(spec).toContain('V7 scope:');
		expect(spec).toContain('Acceptance-proof tests');
		expect(spec).toContain('Requiring real Microsoft, RDP, VNC, SSH, FTP, or FTPS infrastructure');
		expect(readme).toContain('V7 test hardening');
		expect(readme).toContain('docs/coverage-baseline.md');
		expect(coverageDocs).toContain('remaining final target');
		expect(coverageDocs).toContain('Real Microsoft, RDP, VNC, SSH, FTP, and FTPS');
	});

	it('rejects hand-edited external proofs with skipped or secret-looking output', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const skippedSftpProofPath = writeAcceptanceProofFile(directory, {
			...validAcceptanceProofs(),
			realSsh: {
				...validAcceptanceProofs().realSsh,
				output: '[pass] real SSH target exec and SFTP - exec verified; SFTP skipped'
			}
		});
		const secretProofPath = writeAcceptanceProofFile(directory, {
			...validAcceptanceProofs(),
			microsoftSmoke: {
				...validAcceptanceProofs().microsoftSmoke,
				output:
					'[pass] Microsoft Entra discovery and JWKS - loaded Microsoft discovery and 3 JWKS keys\nclient_secret leaked'
			}
		});
		const passwordProofPath = writeAcceptanceProofFile(directory, {
			...validAcceptanceProofs(),
			microsoftInteractive: {
				...validAcceptanceProofs().microsoftInteractive,
				notes:
					'allowed-domain user received a session; blocked-domain user was denied; admin-email user became admin; local login password: hunter2'
			}
		});
		const incompleteFtpsProofPath = writeAcceptanceProofFile(directory, {
			...validAcceptanceProofs(),
			realFtps: {
				...validAcceptanceProofs().realFtps,
				notes:
					'ftps login verified against a real server; ftps tls negotiated successfully; ftps list showed the fixture directory; ftps download matched the fixture file; ftps upload created a redacted file; ftps mkdir created a directory; ftps rename moved the file; ftps delete removed created files; ftps text edit saved redacted content; connection history recorded the session'
			}
		});

		const skippedResult = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: skippedSftpProofPath
		});
		const secretResult = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: secretProofPath
		});
		const passwordResult = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: passwordProofPath
		});
		const incompleteFtpsResult = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: incompleteFtpsProofPath
		});

		expect(skippedResult.status).toBe(2);
		expect(skippedResult.stdout).toContain('[blocked] V1 real SSH host verification');
		expect(secretResult.status).toBe(2);
		expect(secretResult.stdout).toContain('[blocked] V2 real Microsoft Entra discovery');
		expect(passwordResult.status).toBe(2);
		expect(passwordResult.stdout).toContain('[blocked] V2 Microsoft interactive login acceptance');
		expect(incompleteFtpsResult.status).toBe(2);
		expect(incompleteFtpsResult.stdout).toContain('[blocked] V7 real FTPS external proof');
	});

	it('treats absent Microsoft proof as external-blocked when repo-owned proofs pass', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const {
			microsoftSmoke: _microsoftSmoke,
			microsoftInteractive: _microsoftInteractive,
			...proofs
		} = validAcceptanceProofs();
		const proofPath = writeAcceptanceProofFile(directory, proofs);
		const result = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath
		});

		expect(result.status).toBe(2);
		expect(result.stdout).toContain('[external-blocked] V2 real Microsoft Entra discovery');
		expect(result.stdout).toContain('[external-blocked] V2 Microsoft interactive login acceptance');
		expect(result.stdout).toContain(
			'[local] V4 acceptance audit rows preserve Microsoft external-blocked behavior'
		);
		expect(result.stdout).toContain(
			'[local] V5 SSH terminal preferences, snippets, jump hosts, and host-key UX'
		);
		expect(result.stdout).toContain(
			'[local] V5 terminal session recording controls, capture, and retention cleanup'
		);
		expect(result.stdout).toContain('[local] V5 RDP operator controls and host settings');
		expect(result.stdout).toContain(
			'[local] V6 workspace governance and server-side policy decisions'
		);
		expect(result.stdout).toContain('[local] V6 host health and SSH fact intelligence');
		expectV7Rows(result.stdout);
		expect(result.stdout).toContain(
			'acceptance audit: 2 repo-owned requirement(s) still need implementation or stronger local proof'
		);
	});

	it('treats absent real FTP and FTPS proof as external-blocked', () => {
		expect.hasAssertions();
		const directory = tempDirectory();
		const { realFtp: _realFtp, realFtps: _realFtps, ...proofs } = validAcceptanceProofs();
		const proofPath = writeAcceptanceProofFile(directory, proofs);
		const result = runNodeScript(['scripts/acceptance-audit.mjs'], {
			TERMIXKIT_ACCEPTANCE_PROOF_FILE: proofPath
		});

		expect(result.status).toBe(2);
		expect(result.stdout).toContain('[external-blocked] V7 real FTP external proof');
		expect(result.stdout).toContain('[external-blocked] V7 real FTPS external proof');
		expect(result.stdout).toContain(
			'acceptance audit: 2 repo-owned requirement(s) still need implementation or stronger local proof; 2 external proof item(s) remain blocked until real tenant or target infrastructure is available'
		);
	});
});

function expectV7Rows(output: string) {
	expect(output).toContain('[local] V7 coverage tooling and baseline reporting');
	expect(output).toContain('[local] V7 server and security regression foundation');
	expect(output).toContain('[local] V7 fleet wiring and browser workflow foundation');
	expect(output).toContain('[local] V7 coverage ratchet threshold foundation');
	expect(output).toContain('[pending] V7 final coverage target achievement');
	expect(output).toContain('[local] V7 full workflow and protocol browser coverage');
	expect(output).toContain('[local] V7 reliability and performance budget foundation');
	expect(output).toContain('[pending] V7 final reliability and performance budgets');
	expect(output).toContain('[proof-ready] V7 real FTP external proof');
	expect(output).toContain('[proof-ready] V7 real FTPS external proof');
}

function v7AuditRows(output: string): string[] {
	return output
		.split('\n')
		.filter((line) => /^\[[^\]]+\] V7 /.test(line))
		.map((line) => line.replace(/ - .*/, ''));
}

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

function writeAcceptanceProofFile(directory: string, proofs: Record<string, unknown>) {
	const proofPath = join(directory, `acceptance-proof-${(proofFileCounter += 1)}.json`);
	writeFileSync(
		proofPath,
		`${JSON.stringify({ commit: currentCommit(), generatedAt: '2026-05-14T00:00:00.000Z', proofs }, null, 2)}\n`
	);
	return proofPath;
}

function validAcceptanceProofs() {
	const timestamp = '2026-05-14T00:00:00.000Z';
	return {
		realSsh: {
			passed: true,
			timestamp,
			command: 'TERMIXKIT_SMOKE_SSH_HOST=<redacted> npm run smoke:protocols',
			redactedEnv: [
				'TERMIXKIT_SMOKE_SSH_HOST',
				'TERMIXKIT_SMOKE_SSH_USERNAME',
				'TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256'
			],
			output: '[pass] real SSH target exec and SFTP - exec and SFTP verified'
		},
		realVnc: {
			passed: true,
			timestamp,
			command: 'TERMIXKIT_SMOKE_VNC_HOST=<redacted> npm run smoke:protocols',
			redactedEnv: ['TERMIXKIT_SMOKE_VNC_HOST', 'TERMIXKIT_SMOKE_VNC_PORT'],
			output: '[pass] real VNC target framebuffer handshake'
		},
		realRdp: {
			passed: true,
			timestamp,
			command:
				'GATEWAY_URL=<redacted> TERMIXKIT_SMOKE_RDP_HOST=<redacted> npm run smoke:rdp-gateway',
			redactedEnv: [
				'GATEWAY_URL',
				'GATEWAY_PUBLIC_URL',
				'GATEWAY_PROVISIONER_KEY',
				'TERMIXKIT_SMOKE_RDP_HOST'
			],
			output: '[pass] real Devolutions Gateway RDP bootstrap - provisioned tcp://127.0.0.1:3389'
		},
		realFtp: {
			passed: true,
			timestamp,
			command: 'TERMIXKIT_REAL_FTP_PROOF_NOTES=<redacted> npm run acceptance:record-real-ftp',
			redactedEnv: [
				'TERMIXKIT_REAL_FTP_HOST',
				'TERMIXKIT_REAL_FTP_PORT',
				'TERMIXKIT_REAL_FTP_USERNAME',
				'TERMIXKIT_REAL_FTP_EVIDENCE_ID'
			],
			evidenceId: 'ftp-proof-ticket-123',
			notes:
				'ftp login verified against a real server; ftp list showed the fixture directory; ftp download matched the fixture file; ftp upload created a redacted file; ftp mkdir created a directory; ftp rename moved the file; ftp delete removed created files; ftp text edit saved redacted content; connection history recorded the session'
		},
		realFtps: {
			passed: true,
			timestamp,
			command: 'TERMIXKIT_REAL_FTPS_PROOF_NOTES=<redacted> npm run acceptance:record-real-ftps',
			redactedEnv: [
				'TERMIXKIT_REAL_FTPS_HOST',
				'TERMIXKIT_REAL_FTPS_PORT',
				'TERMIXKIT_REAL_FTPS_USERNAME',
				'TERMIXKIT_REAL_FTPS_MODE',
				'TERMIXKIT_REAL_FTPS_CERTIFICATE_POLICY',
				'TERMIXKIT_REAL_FTPS_EVIDENCE_ID'
			],
			evidenceId: 'ftps-proof-ticket-456',
			notes:
				'ftps login verified against a real server; ftps tls negotiated successfully; ftps certificate policy was observed; ftps list showed the fixture directory; ftps download matched the fixture file; ftps upload created a redacted file; ftps mkdir created a directory; ftps rename moved the file; ftps delete removed created files; ftps text edit saved redacted content; connection history recorded the session'
		},
		microsoftSmoke: {
			passed: true,
			timestamp,
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
		},
		microsoftInteractive: {
			passed: true,
			timestamp,
			command: 'manual browser acceptance',
			redactedEnv: [
				'MICROSOFT_TENANT_ID',
				'MICROSOFT_CLIENT_ID',
				'MICROSOFT_ALLOWED_DOMAINS',
				'MICROSOFT_ADMIN_EMAILS'
			],
			notes:
				'allowed-domain user received a session; blocked-domain user was denied; admin-email user became admin; local login credential sign-in still works'
		}
	};
}

function currentCommit() {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
