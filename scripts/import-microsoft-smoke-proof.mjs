import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const defaultArtifactPath = 'microsoft-smoke-proof/acceptance-proof.local.json';
const requiredEnv = [
	'MICROSOFT_AUTH_ENABLED',
	'MICROSOFT_TENANT_ID',
	'MICROSOFT_CLIENT_ID',
	'MICROSOFT_CLIENT_SECRET',
	'MICROSOFT_ALLOWED_DOMAINS',
	'MICROSOFT_ADMIN_EMAILS'
];

const options = parseArgs(process.argv.slice(2));
const artifactPath =
	options.artifact ??
	process.env.TERMKIT_MICROSOFT_SMOKE_ARTIFACT_PROOF_FILE ??
	defaultArtifactPath;
const proofFilePath =
	options.proof ?? process.env.TERMKIT_ACCEPTANCE_PROOF_FILE ?? 'acceptance-proof.local.json';
const currentCommit = currentGitCommit();

if (options.help) {
	printHelp();
	process.exit(0);
}

const artifactProofFile = loadProofFile(artifactPath, 'artifact proof file');
const localProofFile = loadProofFile(proofFilePath, 'local proof file', true) ?? {
	commit: currentCommit,
	generatedAt: new Date().toISOString(),
	proofs: {}
};

if (localProofFile.commit !== currentCommit) {
	console.error(
		`Local proof file ${proofFilePath} targets ${localProofFile.commit ?? '<missing>'}, but current HEAD is ${currentCommit}. Refusing to re-stamp existing proofs; regenerate or update that proof file with fresh evidence for this commit before importing Microsoft smoke proof.`
	);
	process.exit(1);
}

if (artifactProofFile.commit !== currentCommit) {
	console.error(
		`Artifact proof file ${artifactPath} targets ${artifactProofFile.commit ?? '<missing>'}, but current HEAD is ${currentCommit}. Download a proof artifact for the current commit.`
	);
	process.exit(1);
}

const microsoftSmoke = artifactProofFile.proofs?.microsoftSmoke;
const validationErrors = validateMicrosoftSmoke(microsoftSmoke);
if (validationErrors.length > 0) {
	console.error(
		`Artifact proof file ${artifactPath} does not contain an acceptable Microsoft smoke proof:`
	);
	for (const error of validationErrors) console.error(`- ${error}`);
	process.exit(1);
}

localProofFile.generatedAt = new Date().toISOString();
localProofFile.proofs ??= {};
localProofFile.proofs.microsoftSmoke = microsoftSmoke;

writeFileSync(proofFilePath, `${JSON.stringify(localProofFile, null, 2)}\n`);
console.log(`Imported Microsoft smoke proof from ${artifactPath} into ${proofFilePath}.`);

function validateMicrosoftSmoke(proof) {
	const errors = [];
	if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
		return ['proofs.microsoftSmoke must be an object'];
	}

	if (proof.passed !== true) errors.push('proofs.microsoftSmoke.passed must be true');
	if (typeof proof.timestamp !== 'string' || !proof.timestamp.trim()) {
		errors.push('proofs.microsoftSmoke.timestamp is required');
	}
	if (typeof proof.command !== 'string' || !proof.command.includes('npm run smoke:microsoft')) {
		errors.push('proofs.microsoftSmoke.command must include npm run smoke:microsoft');
	}
	if (
		typeof proof.command !== 'string' ||
		!proof.command.includes('TERMKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1')
	) {
		errors.push(
			'proofs.microsoftSmoke.command must include TERMKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1'
		);
	}
	if (!Array.isArray(proof.redactedEnv)) {
		errors.push('proofs.microsoftSmoke.redactedEnv must be an array');
	} else {
		for (const name of requiredEnv) {
			if (!proof.redactedEnv.includes(name)) {
				errors.push(`proofs.microsoftSmoke.redactedEnv is missing ${name}`);
			}
		}
	}

	const output = typeof proof.output === 'string' ? proof.output : '';
	if (!output.includes('[pass] Microsoft Entra discovery and JWKS')) {
		errors.push('proofs.microsoftSmoke.output must include the real discovery/JWKS pass line');
	}
	if (output.includes('[skip] Microsoft Entra discovery and JWKS')) {
		errors.push('proofs.microsoftSmoke.output must not skip real discovery/JWKS');
	}
	if (forbiddenSecretPattern(output)) {
		errors.push(
			`proofs.microsoftSmoke.output appears to include sensitive material (${forbiddenSecretPattern(output)})`
		);
	}

	return errors;
}

function parseArgs(args) {
	const parsed = {
		help: false
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--help' || arg === '-h') {
			parsed.help = true;
		} else if (arg === '--artifact') {
			parsed.artifact = requireValue(args, (index += 1), arg);
		} else if (arg.startsWith('--artifact=')) {
			parsed.artifact = arg.slice('--artifact='.length);
		} else if (arg === '--proof') {
			parsed.proof = requireValue(args, (index += 1), arg);
		} else if (arg.startsWith('--proof=')) {
			parsed.proof = arg.slice('--proof='.length);
		} else if (!parsed.artifact) {
			parsed.artifact = arg;
		} else {
			console.error(`Unknown argument: ${arg}`);
			printHelp();
			process.exit(1);
		}
	}

	return parsed;
}

function requireValue(args, index, flag) {
	const value = args[index]?.trim();
	if (!value) {
		console.error(`${flag} requires a value.`);
		process.exit(1);
	}
	return value;
}

function loadProofFile(path, label, optional = false) {
	if (!existsSync(path)) {
		if (optional) return null;
		console.error(`Could not find ${label}: ${path}`);
		process.exit(1);
	}

	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8'));
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('proof file root must be an object');
		}
		return parsed;
	} catch (error) {
		console.error(`Could not read ${label} ${path}: ${errorText(error)}`);
		process.exit(1);
	}
}

function currentGitCommit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return '<commit-sha>';
	}
}

function forbiddenSecretPattern(value) {
	const checks = [
		[
			/\b(access_token|refresh_token|id_token|client_secret|authorization:\s*bearer|set-cookie|cookie:)\b/i,
			'token or cookie label'
		],
		[/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT-like value']
	];

	for (const [pattern, label] of checks) {
		if (pattern.test(value)) return label;
	}

	return null;
}

function printHelp() {
	console.log(`Usage: npm run acceptance:import-microsoft-smoke -- [artifact-path] [options]

Imports the microsoftSmoke entry from a downloaded GitHub Actions proof artifact
into the local acceptance proof file for the current commit.

Default artifact path: ${defaultArtifactPath}
Default proof file: acceptance-proof.local.json

Options:
  --artifact PATH   Downloaded artifact proof JSON to read
  --proof PATH      Local acceptance proof JSON to update
  -h, --help        Show this help
`);
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
