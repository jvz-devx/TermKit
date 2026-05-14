import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const proofFilePath = process.env.TERMIXKIT_ACCEPTANCE_PROOF_FILE ?? 'acceptance-proof.local.json';
const proofFile = loadProofFile(proofFilePath);
const currentCommit = currentGitCommit();
const proofExpectations = {
	realSsh: {
		commandIncludes: ['npm run smoke:protocols'],
		redactedEnv: [
			'TERMIXKIT_SMOKE_SSH_HOST',
			'TERMIXKIT_SMOKE_SSH_USERNAME',
			'TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256'
		]
	},
	realVnc: {
		commandIncludes: ['npm run smoke:protocols'],
		redactedEnv: ['TERMIXKIT_SMOKE_VNC_HOST', 'TERMIXKIT_SMOKE_VNC_PORT']
	},
	realRdp: {
		commandIncludes: ['npm run smoke:rdp-gateway'],
		redactedEnv: [
			'GATEWAY_URL',
			'GATEWAY_PUBLIC_URL',
			'GATEWAY_PROVISIONER_KEY',
			'TERMIXKIT_SMOKE_RDP_HOST'
		]
	},
	microsoftSmoke: {
		commandIncludes: ['TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1', 'npm run smoke:microsoft'],
		redactedEnv: [
			'MICROSOFT_AUTH_ENABLED',
			'MICROSOFT_TENANT_ID',
			'MICROSOFT_CLIENT_ID',
			'MICROSOFT_CLIENT_SECRET',
			'MICROSOFT_ALLOWED_DOMAINS',
			'MICROSOFT_ADMIN_EMAILS'
		]
	},
	microsoftInteractive: {
		commandIncludes: ['manual browser acceptance'],
		redactedEnv: [
			'MICROSOFT_TENANT_ID',
			'MICROSOFT_CLIENT_ID',
			'MICROSOFT_ALLOWED_DOMAINS',
			'MICROSOFT_ADMIN_EMAILS'
		],
		narrativeIncludes: ['allowed-domain', 'blocked-domain', 'admin-email', 'local login']
	}
};

const checks = [
	{
		name: 'V1 Docker Compose stack',
		status: 'local',
		evidence:
			'npm run smoke:compose verifies generated local Compose env, app readiness, and port exposure'
	},
	{
		name: 'V1 local auth, CRUD, encryption, tickets, importer, build',
		status: 'local',
		evidence: 'npm run check && npm run lint && npm test && npm run build'
	},
	{
		name: 'V1 production app protocol boundary',
		status: 'local',
		evidence: 'npm run smoke:app-protocols'
	},
	{
		name: 'V1 Postgres migrations',
		status: 'local',
		evidence: 'npm run smoke:postgres'
	},
	{
		name: 'V1 WebSocket auth rejection',
		status: 'local',
		evidence: 'npm run smoke:ws'
	},
	{
		name: 'V1 Telnet, SSH, SFTP, and local VNC handshake',
		status: 'local',
		evidence: 'npm run smoke:protocols'
	},
	{
		name: 'V1 real SSH host verification',
		status: externalStatus('TERMIXKIT_ACCEPTANCE_REAL_SSH_PASSED', 'realSsh'),
		evidence:
			'set TERMIXKIT_ACCEPTANCE_REAL_SSH_PASSED or record proofs.realSsh after npm run smoke:protocols passes with real SSH env'
	},
	{
		name: 'V1 real VNC framebuffer verification',
		status: externalStatus('TERMIXKIT_ACCEPTANCE_REAL_VNC_PASSED', 'realVnc'),
		evidence:
			'set TERMIXKIT_ACCEPTANCE_REAL_VNC_PASSED or record proofs.realVnc after npm run smoke:protocols passes with real VNC env'
	},
	{
		name: 'V1 real RDP through Devolutions Gateway',
		status: externalStatus('TERMIXKIT_ACCEPTANCE_REAL_RDP_PASSED', 'realRdp'),
		evidence:
			'set TERMIXKIT_ACCEPTANCE_REAL_RDP_PASSED or record proofs.realRdp after npm run smoke:rdp-gateway passes with real Gateway/RDP env'
	},
	{
		name: 'V2 Microsoft Entra local parser and configuration smoke',
		status: 'local',
		evidence: 'npm run smoke:microsoft validates the local parser fixture without real Entra env'
	},
	{
		name: 'V2 real Microsoft Entra discovery and optional client credentials',
		status: externalStatus('TERMIXKIT_ACCEPTANCE_MICROSOFT_SMOKE_PASSED', 'microsoftSmoke'),
		evidence:
			'set TERMIXKIT_ACCEPTANCE_MICROSOFT_SMOKE_PASSED or record proofs.microsoftSmoke after TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1 npm run smoke:microsoft passes with real Microsoft env'
	},
	{
		name: 'V2 Microsoft interactive login acceptance',
		status: externalStatus('TERMIXKIT_SMOKE_MICROSOFT_INTERACTIVE_PROOF', 'microsoftInteractive'),
		evidence:
			'set TERMIXKIT_SMOKE_MICROSOFT_INTERACTIVE_PROOF or record proofs.microsoftInteractive with manual browser proof for allowed-domain session creation, blocked-domain denial, admin-email promotion, and local login still available'
	},
	{
		name: 'V2 live SSH backend and browser workspace',
		status: 'local',
		evidence: 'npm test live SSH specs and npm run smoke:app-protocols'
	}
];

for (const check of checks) {
	console.log(`${label(check.status)} ${check.name} - ${check.evidence}`);
}

const blocked = checks.filter((check) => check.status === 'blocked');
if (blocked.length > 0) {
	console.log('');
	printProofFileState();
	console.log(
		`acceptance audit: ${blocked.length} requirement(s) still need external env or manual proof`
	);
	process.exitCode = 2;
} else {
	console.log('');
	console.log('acceptance audit: no blocked requirements detected');
}

function label(status) {
	if (status === 'local') return '[local]';
	if (status === 'available') return '[proof-ready]';
	if (status === 'manual') return '[manual]';
	return '[blocked]';
}

function hasEnv(name) {
	return Boolean(process.env[name]?.trim());
}

function externalStatus(envName, proofKey) {
	return hasEnv(envName) || hasProof(proofKey) ? 'available' : 'blocked';
}

function hasProof(proofKey) {
	if (!proofFile) return false;
	if (currentCommit && proofFile.commit !== currentCommit) return false;
	const expectation = proofExpectations[proofKey];
	const proof = proofFile.proofs?.[proofKey];
	return (
		proof?.passed === true &&
		typeof proof.timestamp === 'string' &&
		proof.timestamp.length > 0 &&
		typeof proof.command === 'string' &&
		proof.command.length > 0 &&
		Array.isArray(proof.redactedEnv) &&
		proof.redactedEnv.every((name) => typeof name === 'string' && name.length > 0) &&
		hasExpectedCommand(proof, expectation) &&
		hasExpectedEnv(proof, expectation) &&
		hasProofNarrative(proof, expectation)
	);
}

function hasExpectedCommand(proof, expectation) {
	return expectation.commandIncludes.every((fragment) => proof.command.includes(fragment));
}

function hasExpectedEnv(proof, expectation) {
	return expectation.redactedEnv.every((name) => proof.redactedEnv.includes(name));
}

function hasProofNarrative(proof, expectation) {
	const narrative =
		(typeof proof.output === 'string' && proof.output.trim().length > 0) ||
		(typeof proof.notes === 'string' && proof.notes.trim().length > 0);
	if (!narrative) return false;
	if (!expectation.narrativeIncludes) return true;
	const text = `${proof.output ?? ''}\n${proof.notes ?? ''}`.toLowerCase();
	return expectation.narrativeIncludes.every((fragment) => text.includes(fragment));
}

function printProofFileState() {
	if (!proofFile) {
		console.log(
			`external proof file: ${proofFilePath} not found; run npm run acceptance:proof-template -- ${proofFilePath} from inside nix develop`
		);
		return;
	}
	if (currentCommit && proofFile.commit !== currentCommit) {
		console.log(
			`external proof file: ${proofFilePath} targets ${proofFile.commit ?? '<missing>'}, current commit is ${currentCommit}`
		);
		return;
	}
	console.log(`external proof file: ${proofFilePath}`);
}

function loadProofFile(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		console.error(`Could not read acceptance proof file ${path}: ${errorText(error)}`);
		return null;
	}
}

function currentGitCommit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
