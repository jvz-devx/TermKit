import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const proofFilePath = process.env.TERMKIT_ACCEPTANCE_PROOF_FILE ?? 'acceptance-proof.local.json';
const timestamp = new Date().toISOString();
const commit = currentCommit();
const proofKind = process.argv[2];
const configs = {
	realSsh: {
		label: 'real SSH target',
		command: ['npm', ['run', 'smoke:protocols']],
		requiredEnv: [
			'TERMKIT_SMOKE_SSH_HOST',
			'TERMKIT_SMOKE_SSH_USERNAME',
			'TERMKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256'
		],
		secretEnv: ['TERMKIT_SMOKE_SSH_PASSWORD', 'TERMKIT_SMOKE_SSH_PRIVATE_KEY_PATH'],
		redactedEnv: [
			'TERMKIT_SMOKE_SSH_HOST',
			'TERMKIT_SMOKE_SSH_USERNAME',
			'TERMKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256'
		],
		passLine: '[pass] real SSH target exec and SFTP',
		skipLine: '[skip] real SSH target exec and SFTP',
		disallowedOutput: ['SFTP skipped'],
		proofCommand: 'TERMKIT_SMOKE_SSH_HOST=<redacted> npm run smoke:protocols'
	},
	realVnc: {
		label: 'real VNC framebuffer',
		command: ['npm', ['run', 'smoke:protocols']],
		requiredEnv: ['TERMKIT_SMOKE_VNC_HOST'],
		redactedEnv: ['TERMKIT_SMOKE_VNC_HOST', 'TERMKIT_SMOKE_VNC_PORT'],
		passLine: '[pass] real VNC target framebuffer handshake',
		skipLine: '[skip] real VNC target framebuffer handshake',
		proofCommand: 'TERMKIT_SMOKE_VNC_HOST=<redacted> npm run smoke:protocols'
	},
	realRdp: {
		label: 'reachable RDP target bootstrap through Devolutions Gateway',
		command: ['npm', ['run', 'smoke:rdp-gateway']],
		requiredEnv: [
			'GATEWAY_URL',
			'GATEWAY_PUBLIC_URL',
			'GATEWAY_PROVISIONER_KEY',
			'TERMKIT_SMOKE_RDP_HOST'
		],
		redactedEnv: [
			'GATEWAY_URL',
			'GATEWAY_PUBLIC_URL',
			'GATEWAY_PROVISIONER_KEY',
			'TERMKIT_SMOKE_RDP_HOST'
		],
		passLine: '[pass] real Devolutions Gateway RDP bootstrap',
		skipLine: '[skip] real Devolutions Gateway RDP bootstrap',
		proofCommand:
			'GATEWAY_URL=<redacted> TERMKIT_SMOKE_RDP_HOST=<redacted> npm run smoke:rdp-gateway'
	},
	realFtp: {
		label: 'real FTP target file-manager workflow',
		requiredEnv: [
			'TERMKIT_REAL_FTP_HOST',
			'TERMKIT_REAL_FTP_PORT',
			'TERMKIT_REAL_FTP_USERNAME',
			'TERMKIT_REAL_FTP_EVIDENCE_ID'
		],
		evidenceEnv: 'TERMKIT_REAL_FTP_EVIDENCE_ID',
		notesEnv: 'TERMKIT_REAL_FTP_PROOF_NOTES',
		notesFileEnv: 'TERMKIT_REAL_FTP_PROOF_NOTES_FILE',
		redactedEnv: [
			'TERMKIT_REAL_FTP_HOST',
			'TERMKIT_REAL_FTP_PORT',
			'TERMKIT_REAL_FTP_USERNAME',
			'TERMKIT_REAL_FTP_EVIDENCE_ID'
		],
		requiredFragments: [
			'ftp login',
			'ftp list',
			'ftp download',
			'ftp upload',
			'ftp mkdir',
			'ftp rename',
			'ftp delete',
			'ftp text edit',
			'connection history'
		],
		proofCommand:
			'TERMKIT_REAL_FTP_HOST=<redacted> TERMKIT_REAL_FTP_EVIDENCE_ID=<redacted> TERMKIT_REAL_FTP_PROOF_NOTES=<redacted> npm run acceptance:record-real-ftp'
	},
	realFtps: {
		label: 'real FTPS target file-manager workflow',
		requiredEnv: [
			'TERMKIT_REAL_FTPS_HOST',
			'TERMKIT_REAL_FTPS_PORT',
			'TERMKIT_REAL_FTPS_USERNAME',
			'TERMKIT_REAL_FTPS_MODE',
			'TERMKIT_REAL_FTPS_CERTIFICATE_POLICY',
			'TERMKIT_REAL_FTPS_EVIDENCE_ID'
		],
		evidenceEnv: 'TERMKIT_REAL_FTPS_EVIDENCE_ID',
		notesEnv: 'TERMKIT_REAL_FTPS_PROOF_NOTES',
		notesFileEnv: 'TERMKIT_REAL_FTPS_PROOF_NOTES_FILE',
		redactedEnv: [
			'TERMKIT_REAL_FTPS_HOST',
			'TERMKIT_REAL_FTPS_PORT',
			'TERMKIT_REAL_FTPS_USERNAME',
			'TERMKIT_REAL_FTPS_MODE',
			'TERMKIT_REAL_FTPS_CERTIFICATE_POLICY',
			'TERMKIT_REAL_FTPS_EVIDENCE_ID'
		],
		requiredFragments: [
			'ftps login',
			'ftps tls',
			'ftps certificate',
			'ftps list',
			'ftps download',
			'ftps upload',
			'ftps mkdir',
			'ftps rename',
			'ftps delete',
			'ftps text edit',
			'connection history'
		],
		proofCommand:
			'TERMKIT_REAL_FTPS_HOST=<redacted> TERMKIT_REAL_FTPS_EVIDENCE_ID=<redacted> TERMKIT_REAL_FTPS_PROOF_NOTES=<redacted> npm run acceptance:record-real-ftps'
	}
};

if (proofKind === '--help' || proofKind === '-h') {
	printHelp();
	process.exit(0);
}

const config = configs[proofKind];
if (!config) {
	console.error(`Unknown external proof kind: ${proofKind ?? '<missing>'}`);
	printHelp();
	process.exit(1);
}

const missingEnv = missingRequiredEnv(config);
if (missingEnv.length > 0) {
	console.error(
		`${config.label} proof is missing required environment variable(s): ${missingEnv.join(', ')}`
	);
	process.exit(1);
}

const proofFileExists = existsSync(proofFilePath);
const proofFile = loadProofFile(proofFilePath);
if (proofFileExists && proofFile.commit !== commit) {
	console.error(
		`Proof file ${proofFilePath} targets ${proofFile.commit ?? '<missing>'}, but current HEAD is ${commit}. Refusing to re-stamp existing proofs; regenerate or refresh the proof file with fresh evidence for this commit before recording ${config.label} proof.`
	);
	process.exit(1);
}

let output = '';
let notes = '';
if (config.notesEnv) {
	notes = readProofNotes(config);
} else {
	const result = spawnSync(config.command[0], config.command[1], {
		cwd: process.cwd(),
		env: process.env,
		encoding: 'utf8'
	});
	output = joinOutput(result.stdout, result.stderr);
	if (output) process.stdout.write(`${output}\n`);

	if (result.status !== 0) {
		console.error(`${config.label} smoke did not pass; proof file was not updated.`);
		process.exit(result.status ?? 1);
	}
}

const validationErrors = config.notesEnv
	? validateManualNotes(config, notes)
	: validateOutput(config, output);
const evidenceId = config.evidenceEnv ? process.env[config.evidenceEnv]?.trim() : '';
if (evidenceId && forbiddenSecretPattern(evidenceId)) {
	validationErrors.push(
		`${config.evidenceEnv} appears to include sensitive material (${forbiddenSecretPattern(evidenceId)})`
	);
}
if (evidenceId && placeholderPattern(evidenceId)) {
	validationErrors.push(
		`${config.evidenceEnv} still looks like a template placeholder (${placeholderPattern(evidenceId)})`
	);
}
if (validationErrors.length > 0) {
	console.error(`${config.label} proof is not acceptable:`);
	for (const error of validationErrors) console.error(`- ${error}`);
	process.exit(1);
}

proofFile.commit = commit;
proofFile.generatedAt ??= timestamp;
proofFile.proofs ??= {};
proofFile.proofs[proofKind] = {
	passed: true,
	timestamp,
	command: config.proofCommand,
	instructions:
		'Generated by npm run acceptance:record-real-* after real external proof passed local validation. Keep command values redacted and do not store target passwords, private keys, session tokens, or cookies.',
	redactedEnv: config.redactedEnv,
	output
};
if (notes) proofFile.proofs[proofKind].notes = notes;
if (evidenceId) proofFile.proofs[proofKind].evidenceId = evidenceId;

writeFileSync(proofFilePath, `${JSON.stringify(proofFile, null, 2)}\n`);
console.log(`Recorded ${config.label} proof in ${proofFilePath}.`);

function missingRequiredEnv(config) {
	const missing = (config.requiredEnv ?? []).filter((name) => !process.env[name]?.trim());
	if (config.secretEnv?.length && !config.secretEnv.some((name) => process.env[name]?.trim())) {
		missing.push(config.secretEnv.join(' or '));
	}
	if (
		config.notesEnv &&
		!process.env[config.notesEnv]?.trim() &&
		!process.env[config.notesFileEnv]?.trim()
	) {
		missing.push(`${config.notesEnv} or ${config.notesFileEnv}`);
	}
	return missing;
}

function readProofNotes(config) {
	const inlineNotes = process.env[config.notesEnv]?.trim();
	if (inlineNotes) return inlineNotes;

	const notesPath = process.env[config.notesFileEnv]?.trim();
	if (!notesPath) return '';
	try {
		return readFileSync(notesPath, 'utf8').trim();
	} catch (error) {
		console.error(
			`Could not read ${config.label} proof notes file ${notesPath}: ${errorText(error)}`
		);
		process.exit(1);
	}
}

function validateManualNotes(config, notes) {
	const errors = [];
	const text = notes.trim();
	if (!text) errors.push('notes must not be empty');
	const lower = text.toLowerCase();
	for (const fragment of config.requiredFragments) {
		if (!lower.includes(fragment)) errors.push(`notes must include ${fragment}`);
	}
	if (forbiddenSecretPattern(text)) {
		errors.push(`notes appear to include sensitive material (${forbiddenSecretPattern(text)})`);
	}
	if (placeholderPattern(text)) {
		errors.push(`notes still look like a template placeholder (${placeholderPattern(text)})`);
	}
	return errors;
}

function validateOutput(config, output) {
	const errors = [];
	if (!output.includes(config.passLine)) errors.push(`output must include ${config.passLine}`);
	if (output.includes(config.skipLine)) errors.push(`output must not include ${config.skipLine}`);
	for (const fragment of config.disallowedOutput ?? []) {
		if (output.includes(fragment)) errors.push(`output must not include ${fragment}`);
	}
	if (forbiddenSecretPattern(output)) {
		errors.push(`output appears to include sensitive material (${forbiddenSecretPattern(output)})`);
	}
	return errors;
}

function loadProofFile(path) {
	if (!existsSync(path)) {
		return { commit, generatedAt: timestamp, proofs: {} };
	}

	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8'));
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('proof file root must be an object');
		}
		return parsed;
	} catch (error) {
		console.error(`Could not read acceptance proof file ${path}: ${errorText(error)}`);
		process.exit(1);
	}
}

function currentCommit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return '<commit-sha>';
	}
}

function joinOutput(stdout, stderr) {
	return [stdout, stderr]
		.map((value) => value?.trim())
		.filter(Boolean)
		.join('\n');
}

function forbiddenSecretPattern(value) {
	const checks = [
		[
			/\b(password|private[_ -]?key|access_token|refresh_token|id_token|client_secret|authorization:\s*bearer|set-cookie|cookie:)\b/i,
			'secret, token, or cookie label'
		],
		[
			/\b[A-Z0-9_]*(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|PASSPHRASE|KEY)[A-Z0-9_]*\s*=/i,
			'env-style secret label'
		],
		[/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT-like value']
	];

	for (const [pattern, label] of checks) {
		if (pattern.test(value)) return label;
	}

	return null;
}

function placeholderPattern(value) {
	const checks = [
		[/\bTODO\b/i, 'TODO marker'],
		[/replace with/i, 'template instruction'],
		[/\.\.\./, 'ellipsis placeholder']
	];

	for (const [pattern, label] of checks) {
		if (pattern.test(value)) return label;
	}

	return null;
}

function printHelp() {
	console.log(`Usage: node scripts/record-external-proof.mjs <realSsh|realVnc|realRdp|realFtp|realFtps>

Runs the matching real-target smoke or validates redacted external proof notes,
then records a current-commit proof entry in ${proofFilePath}. Existing proof
files must already target the current HEAD.

Package aliases:
  npm run acceptance:record-real-ssh
  npm run acceptance:record-real-vnc
  npm run acceptance:record-real-rdp
  npm run acceptance:record-real-ftp
  npm run acceptance:record-real-ftps

FTP notes env:
  TERMKIT_REAL_FTP_PROOF_NOTES or TERMKIT_REAL_FTP_PROOF_NOTES_FILE

FTPS notes env:
  TERMKIT_REAL_FTPS_PROOF_NOTES or TERMKIT_REAL_FTPS_PROOF_NOTES_FILE
`);
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
