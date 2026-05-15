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
		],
		passLine: '[pass] real SSH target exec and SFTP',
		skipLine: '[skip] real SSH target exec and SFTP',
		disallowedOutput: ['SFTP skipped']
	},
	realVnc: {
		commandIncludes: ['npm run smoke:protocols'],
		redactedEnv: ['TERMIXKIT_SMOKE_VNC_HOST', 'TERMIXKIT_SMOKE_VNC_PORT'],
		passLine: '[pass] real VNC target framebuffer handshake',
		skipLine: '[skip] real VNC target framebuffer handshake'
	},
	realRdp: {
		commandIncludes: ['npm run smoke:rdp-gateway'],
		redactedEnv: [
			'GATEWAY_URL',
			'GATEWAY_PUBLIC_URL',
			'GATEWAY_PROVISIONER_KEY',
			'TERMIXKIT_SMOKE_RDP_HOST'
		],
		passLine: '[pass] real Devolutions Gateway RDP bootstrap',
		skipLine: '[skip] real Devolutions Gateway RDP bootstrap'
	},
	realFtp: {
		commandIncludes: ['npm run acceptance:record-real-ftp'],
		redactedEnv: [
			'TERMIXKIT_REAL_FTP_HOST',
			'TERMIXKIT_REAL_FTP_PORT',
			'TERMIXKIT_REAL_FTP_USERNAME',
			'TERMIXKIT_REAL_FTP_EVIDENCE_ID'
		],
		evidenceRequired: true,
		narrativeIncludes: [
			'ftp login',
			'ftp list',
			'ftp download',
			'ftp upload',
			'ftp mkdir',
			'ftp rename',
			'ftp delete',
			'ftp text edit',
			'connection history'
		]
	},
	realFtps: {
		commandIncludes: ['npm run acceptance:record-real-ftps'],
		redactedEnv: [
			'TERMIXKIT_REAL_FTPS_HOST',
			'TERMIXKIT_REAL_FTPS_PORT',
			'TERMIXKIT_REAL_FTPS_USERNAME',
			'TERMIXKIT_REAL_FTPS_MODE',
			'TERMIXKIT_REAL_FTPS_CERTIFICATE_POLICY',
			'TERMIXKIT_REAL_FTPS_EVIDENCE_ID'
		],
		evidenceRequired: true,
		narrativeIncludes: [
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
		],
		passLine: '[pass] Microsoft Entra discovery and JWKS',
		skipLine: '[skip] Microsoft Entra discovery and JWKS'
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
		name: 'V1 Docker Compose deploys with one public web port',
		status: 'local',
		evidence:
			'npm run smoke:compose verifies generated local Compose env, app readiness, and port exposure'
	},
	{
		name: 'V1 first-run admin creation and local login',
		status: 'local',
		evidence: 'npm run smoke:app-protocols drives first-run admin creation and login'
	},
	{
		name: 'V1 protected routes, API auth, cookie sessions, and session lookup',
		status: 'local',
		evidence: 'npm test covers auth/session services and npm run smoke:ws covers auth rejection'
	},
	{
		name: 'V1 host and credential CRUD',
		status: 'local',
		evidence: 'npm test covers services and npm run smoke:app-protocols creates hosts/credentials'
	},
	{
		name: 'V1 saved secrets are encrypted in Postgres',
		status: 'local',
		evidence: 'npm test covers credential encryption/decryption and repository storage'
	},
	{
		name: 'V1 ticket expiration, single-use behavior, and websocket auth rejection',
		status: 'local',
		evidence:
			'npm test covers session tickets and npm run smoke:ws covers production websocket rejection'
	},
	{
		name: 'V1 Postgres migrations',
		status: 'local',
		evidence: 'npm run smoke:postgres'
	},
	{
		name: 'V1 SSH terminal works in the browser',
		status: 'local',
		evidence:
			'npm run smoke:app-protocols opens SSH websocket through Chromium against disposable SSH target'
	},
	{
		name: 'V1 SFTP file manager list/download/upload/edit/rename/delete',
		status: 'local',
		evidence: 'npm run smoke:app-protocols exercises authenticated SFTP API workflow'
	},
	{
		name: 'V1 Telnet terminal works in the browser',
		status: 'local',
		evidence:
			'npm run smoke:app-protocols opens Telnet websocket through Chromium; npm run smoke:protocols verifies Telnet negotiation'
	},
	{
		name: 'V1 VNC works without Guacamole',
		status: 'local',
		evidence:
			'npm run smoke:app-protocols opens VNC websocket through Chromium; npm run smoke:protocols verifies no-auth RFB handshakes'
	},
	{
		name: 'V1 RDP launches through IronRDP and Devolutions Gateway without Guacamole',
		status: 'local',
		evidence:
			'npm run smoke:app-protocols validates RDP browser launch metadata and saved-password handling'
	},
	{
		name: 'V1 Termix importer brings supported data with summary and warnings',
		status: 'local',
		evidence:
			'npm test covers Termix JSON/SQLite import mapping, warnings, and import job persistence'
	},
	{
		name: 'V1 real SSH host verification',
		status: externalStatus('realSsh'),
		evidence:
			'run nix develop -c npm run acceptance:record-real-ssh after exporting real SSH env; records proofs.realSsh only when npm run smoke:protocols passes'
	},
	{
		name: 'V1 real VNC framebuffer verification',
		status: externalStatus('realVnc'),
		evidence:
			'run nix develop -c npm run acceptance:record-real-vnc after exporting real VNC env; records proofs.realVnc only when npm run smoke:protocols passes'
	},
	{
		name: 'V1 reachable RDP target bootstrap through Devolutions Gateway',
		status: externalStatus('realRdp'),
		evidence:
			'run nix develop -c npm run acceptance:record-real-rdp after exporting real Gateway/RDP env; records proofs.realRdp only when npm run smoke:rdp-gateway reaches the target TCP endpoint and Gateway provisioning passes'
	},
	{
		name: 'V1 checks, tests, and production build',
		status: 'local',
		evidence: 'npm run check && npm run lint && npm test && npm run test:e2e && npm run build'
	},
	{
		name: 'V2 Microsoft Entra config validation, login routes, callback routes, and UI affordance',
		status: 'local',
		evidence:
			'npm test covers Microsoft config/OIDC/routes and npm run smoke:microsoft validates local parser fixture'
	},
	{
		name: 'V2 Microsoft auth_identities schema and local-session reuse',
		status: 'local',
		evidence:
			'npm test covers auth identity schema, Microsoft callback provisioning, and V1 session cookie creation'
	},
	{
		name: 'V2 real Microsoft Entra discovery and optional client credentials',
		status: externalStatus('microsoftSmoke', { externalOnly: true }),
		evidence:
			'run nix develop -c npm run acceptance:record-microsoft-smoke after exporting real Microsoft env, or import the GitHub microsoft-smoke-proof artifact for the current commit'
	},
	{
		name: 'V2 Microsoft interactive login acceptance',
		status: externalStatus('microsoftInteractive', { externalOnly: true }),
		evidence:
			'run nix develop -c npm run acceptance:record-microsoft-interactive after collecting manual browser proof for allowed-domain session creation, blocked-domain denial, admin-email promotion, and local login still available'
	},
	{
		name: 'V2 live SSH schema, services, limits, attach tickets, idle cleanup, and stale startup reconciliation',
		status: 'local',
		evidence:
			'npm test covers live SSH service/repository behavior and startup stale reconciliation'
	},
	{
		name: 'V2 live SSH manager detach, reattach, takeover, explicit close, and bounded scrollback',
		status: 'local',
		evidence: 'npm test covers LiveSshManager and websocket upgrade live SSH lifecycle'
	},
	{
		name: 'V2 persistent SSH workspace UI for open/list/rename/reattach/close and states',
		status: 'local',
		evidence:
			'npm run smoke:app-protocols drives Chromium through live SSH workspace attach; components expose tab strip states/actions'
	},
	{
		name: 'V2 terminal output is not persisted to Postgres',
		status: 'local',
		evidence:
			'npm test covers live SSH metadata tables; LiveSshManager keeps scrollback in bounded in-memory buffers'
	},
	{
		name: 'V2 keeps V1 SSH, SFTP, Telnet, VNC, RDP, importer, tests, and build passing',
		status: 'local',
		evidence:
			'npm run smoke:app-protocols plus npm run check && npm run lint && npm test && npm run build'
	},
	{
		name: 'V3 workspaces for shared hosts, credentials, owners, and members',
		status: 'local',
		evidence:
			'npm test covers workspace service/repository authorization, host and credential scoping, rename, member removal, and inventory assignment'
	},
	{
		name: 'V3 connection history screen with filters and structured error reasons',
		status: 'local',
		evidence:
			'npm test covers connection history persistence/filter data and npm run check validates the history route UI'
	},
	{
		name: 'V3 RDP clipboard policy and file clipboard transfer controls',
		status: 'local',
		evidence:
			'npm test covers settings policy validation and npm run check validates RDP session clipboard controls and transfer states'
	},
	{
		name: 'V3 central admin panel for users, workspaces, live sessions, history, and settings',
		status: 'local',
		evidence:
			'npm run check validates the admin route and remote functions for user creation, disable, promote, session termination, and overview data'
	},
	{
		name: 'V3 session workspace polish keeps protocol panes responsive and stateful',
		status: 'local',
		evidence:
			'npm run check && npm run build validate the polished session workspace, protocol state panels, fullscreen controls, and responsive layout'
	},
	{
		name: 'V4 admin SSH tunnel visibility and termination',
		status: 'local',
		evidence:
			'npm test covers admin protocol visibility helpers and npm run check validates the SSH tunnel termination command/UI'
	},
	{
		name: 'V4 admin FTP and FTPS long-running activity visibility',
		status: 'local',
		evidence:
			'npm test covers V4 admin FTP/FTPS protocol labels and npm run check validates active transfer state tables'
	},
	{
		name: 'V4 connection history includes ssh_tunnel, ftp, ftps, and structured failure reasons',
		status: 'local',
		evidence:
			'npm test covers V4 admin protocol/failure formatting and npm run check validates structured failure reason rendering'
	},
	{
		name: 'V4 acceptance audit rows preserve Microsoft external-blocked behavior',
		status: 'local',
		evidence:
			'npm test covers acceptance-audit V4 rows while missing Microsoft tenant/browser proof remains external-blocked'
	},
	{
		name: 'V5 SSH terminal preferences, snippets, jump hosts, and host-key UX',
		status: 'local',
		evidence:
			'npm test covers V5 terminal preference/snippet repositories, jump-host routing for SSH/SFTP/tunnels, host-key enrollment, and npm run smoke:postgres verifies migration compatibility'
	},
	{
		name: 'V5 terminal session recording controls, capture, and retention cleanup',
		status: 'local',
		evidence:
			'npm test covers disabled-by-default browser recording helpers, asciicast capture output, local retention cleanup, and npm run check validates explicit terminal controls'
	},
	{
		name: 'V5 SFTP file-manager bookmarks and transfer power tools',
		status: 'local',
		evidence:
			'npm test covers V5 file bookmark repository support, recursive transfer limits, transfer state helpers, and npm run smoke:app-protocols verifies SFTP workspace flows'
	},
	{
		name: 'V5 FTP and FTPS mode settings plus runtime TLS behavior',
		status: 'local',
		evidence:
			'npm test covers V5 FTPS host settings, explicit/implicit TLS options, structured failures, and npm run smoke:postgres verifies ftps_mode plus ftps_host_settings'
	},
	{
		name: 'V5 RDP operator controls and host settings',
		status: 'local',
		evidence:
			'npm test covers V5 RDP host settings, operator-control helpers, audio gateway capability, and npm run smoke:app-protocols verifies the RDP launch boundary'
	},
	{
		name: 'V6 automation templates support typed previews and secret masking',
		status: 'local',
		evidence:
			'npm test covers SSH command, file-transfer, SSH tunnel, RDP checklist, and operator-note templates with typed variables, validation, version metadata, workspace/private visibility, and secret-safe previews'
	},
	{
		name: 'V6 bulk jobs enforce reviewed targets, concurrency, retry, cancellation, and reports',
		status: 'local',
		evidence:
			'npm test covers bulk SSH and SFTP/FTP/FTPS job planning, explicit host review, hidden-host rejection, concurrency scheduling, cancellation, retry eligibility, per-host status, partial failures, and secret-safe downloadable reports'
	},
	{
		name: 'V6 job history and resource persistence schema',
		status: 'local',
		evidence:
			'npm test covers V6 resource repositories and npm run smoke:postgres verifies automation, job, report, policy, approval, reason, host fact, and host health migration compatibility'
	},
	{
		name: 'V6 workspace governance and server-side policy decisions',
		status: 'local',
		evidence:
			'npm test covers viewer/operator/maintainer/owner policy decisions, blocked UI state parity, approval gates, reason gates, sensitive hosts, dangerous templates, high host counts, and risky transfers'
	},
	{
		name: 'V6 host health and SSH fact intelligence',
		status: 'local',
		evidence:
			'npm test covers SSH fact parsing for OS, kernel, uptime, disk, memory, service hints, and health states for stale hosts, broken credentials, repeated failures, never-used hosts, and healthy hosts'
	},
	{
		name: 'V6 fleet operations UI shell and navigation',
		status: 'local',
		evidence:
			'npm run check validates the slim /fleet route plus shadcn-svelte fleet panels for automation templates, reviewed bulk operations, job history/reporting, policy approvals, and host health inventory'
	},
	{
		name: 'V7 coverage tooling and baseline reporting',
		status: 'local',
		evidence:
			'npm run test:coverage generates text, HTML, JSON, and lcov reports; CI runs coverage; docs/coverage-baseline.md records the first baseline and initial ratchet gates'
	},
	{
		name: 'V7 server and security regression foundation',
		status: 'local',
		evidence:
			'npm test covers added credential metadata redaction, session-ticket credential snapshots, V6 job/event/report redaction, policy reasons, and secret-safe bulk job reports'
	},
	{
		name: 'V7 fleet wiring and browser workflow foundation',
		status: 'local',
		evidence:
			'npm test covers the shared fleet operation contract and source-level drift checks; npm run test:e2e covers /fleet navigation, disabled no-target queue state, approval-required review state, and inventory filtering'
	},
	{
		name: 'V7 coverage ratchet threshold foundation',
		status: 'local',
		evidence:
			'npm run test:coverage enforces the current global ratchet plus scoped auth, crypto, import, Termix domain, live SSH, bulk-job runner, and file-manager-state thresholds; docs/coverage-baseline.md documents the measured floor'
	},
	{
		name: 'V7 final coverage target achievement',
		status: 'local',
		evidence:
			'npm run test:coverage proves the final spec.md coverage targets: src/lib/server/** is 88.52% lines and 82.64% branches, security-critical pure logic is 94.59% lines, protocol adapter and websocket-owned logic is 89.31% lines, and importer/repository/settings/workspace/policy/job-owned logic is 88.24% lines; docs/coverage-baseline.md documents the include/exclude boundary'
	},
	{
		name: 'V7 full workflow and protocol browser coverage',
		status: 'local',
		evidence:
			'npm run test:e2e covers auth, inventory, importer, workspace launch states, browser-level SFTP/FTP/FTPS UI actions with mocked protocol API fixtures, RDP/VNC/Telnet launch and reconnect/close states, admin, fleet, and server-enforced policy-blocked API denial; npm run smoke:app-protocols covers browser-level SFTP/FTP/FTPS file actions against disposable real local protocol endpoints without route interception, Telnet xterm input/NAWS/close/reconnect against a disposable fixture, VNC noVNC launch/disconnect/reconnect against a disposable RFB fixture, and local mocked RDP Gateway launch/clipboard-policy/reconnect controls plus the server-side JET proxy route without proving browser-driven JET traffic or real target pixels'
	},
	{
		name: 'V7 reliability and performance budget foundation',
		status: 'local',
		evidence:
			'npm test covers live SSH attach takeover, connection and shell failure injection, single-use ticket rejection paths, bulk-job concurrency, cancellation, timeout/retry behavior, secret-safe reports, large fan-out planning invariants, and file-list transform invariants; npm run test:performance owns coarse wall-clock budget checks outside the default unit suite'
	},
	{
		name: 'V7 final reliability and performance budgets',
		status: 'local',
		evidence:
			'npm test enforces deterministic boundedness checks for protocol failure/timeout boundaries, adapter upload-size limits, route-level multipart upload preflight/stream limits, transfer completion/cancellation/progress helpers, importer parsing, workspace layout normalization, bulk-job fan-out, retry, timeout, and cancellation behavior; npm run test:e2e covers browser-level transfer cancellation and partial-progress behavior without false completion; npm run test:performance runs the explicit coarse budget checks for importer parsing/validation, file-listing transforms, job fan-out scheduling, fleet filtering, and workspace layout/rendering helpers outside the default unit suite'
	},
	{
		name: 'V7 real FTP external proof',
		status: externalStatus('realFtp', { externalOnly: true }),
		evidence:
			'run nix develop -c npm run acceptance:record-real-ftp with redacted FTP target env, TERMIXKIT_REAL_FTP_EVIDENCE_ID, and TERMIXKIT_REAL_FTP_PROOF_NOTES after external FTP proof covers ftp login, ftp list, ftp download, ftp upload, ftp mkdir, ftp rename, ftp delete, ftp text edit, and connection history'
	},
	{
		name: 'V7 real FTPS external proof',
		status: externalStatus('realFtps', { externalOnly: true }),
		evidence:
			'run nix develop -c npm run acceptance:record-real-ftps with redacted FTPS target env, TERMIXKIT_REAL_FTPS_EVIDENCE_ID, and TERMIXKIT_REAL_FTPS_PROOF_NOTES after external FTPS proof covers ftps login, ftps tls, ftps certificate, ftps list, ftps download, ftps upload, ftps mkdir, ftps rename, ftps delete, ftps text edit, and connection history'
	}
];

for (const check of checks) {
	console.log(`${label(check.status)} ${check.name} - ${check.evidence}`);
}

const blocked = checks.filter((check) => check.status === 'blocked' || check.status === 'pending');
const externalBlocked = checks.filter((check) => check.status === 'external-blocked');
if (blocked.length > 0) {
	console.log('');
	printProofFileState();
	const externalSummary =
		externalBlocked.length > 0
			? `; ${externalBlocked.length} external proof item(s) remain blocked until real tenant or target infrastructure is available`
			: '';
	console.log(
		`acceptance audit: ${blocked.length} repo-owned requirement(s) still need implementation or stronger local proof${externalSummary}`
	);
	process.exitCode = 2;
} else {
	console.log('');
	if (externalBlocked.length > 0) {
		printProofFileState();
		console.log(
			`acceptance audit: repo-owned requirements passed; ${externalBlocked.length} external proof item(s) remain blocked until real tenant or target infrastructure is available`
		);
	} else {
		console.log('acceptance audit: no blocked requirements detected');
	}
}

function label(status) {
	if (status === 'local') return '[local]';
	if (status === 'available') return '[proof-ready]';
	if (status === 'pending') return '[pending]';
	if (status === 'manual') return '[manual]';
	if (status === 'external-blocked') return '[external-blocked]';
	return '[blocked]';
}

function externalStatus(proofKey, options = {}) {
	if (hasProof(proofKey)) return 'available';
	if (options.externalOnly && proofFile?.proofs?.[proofKey]?.passed !== true) {
		return 'external-blocked';
	}
	return 'blocked';
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
		hasExpectedOutput(proof, expectation) &&
		hasExpectedEvidence(proof, expectation) &&
		hasProofNarrative(proof, expectation)
	);
}

function hasExpectedCommand(proof, expectation) {
	return expectation.commandIncludes.every((fragment) => proof.command.includes(fragment));
}

function hasExpectedEnv(proof, expectation) {
	return expectation.redactedEnv.every((name) => proof.redactedEnv.includes(name));
}

function hasExpectedOutput(proof, expectation) {
	const output = typeof proof.output === 'string' ? proof.output : '';
	const notes = typeof proof.notes === 'string' ? proof.notes : '';
	const text = `${output}\n${notes}`;
	if (forbiddenSecretPattern(text)) return false;
	if (expectation.passLine && !output.includes(expectation.passLine)) return false;
	if (expectation.skipLine && output.includes(expectation.skipLine)) return false;
	for (const fragment of expectation.disallowedOutput ?? []) {
		if (output.includes(fragment)) return false;
	}
	return true;
}

function hasExpectedEvidence(proof, expectation) {
	if (!expectation.evidenceRequired) return true;
	return (
		typeof proof.evidenceId === 'string' &&
		proof.evidenceId.trim().length > 0 &&
		!forbiddenSecretPattern(proof.evidenceId) &&
		!placeholderPattern(proof.evidenceId)
	);
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

function forbiddenSecretPattern(value) {
	const checks = [
		[/\bpassword\b/i, 'password label'],
		[
			/\b(private[_ -]?key|access_token|refresh_token|id_token|client_secret|authorization:\s*bearer|set-cookie|cookie:)\b/i,
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
