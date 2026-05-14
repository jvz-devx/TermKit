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
		status: hasEnv('TERMIXKIT_ACCEPTANCE_REAL_SSH_PASSED') ? 'available' : 'blocked',
		evidence:
			'set TERMIXKIT_ACCEPTANCE_REAL_SSH_PASSED after npm run smoke:protocols passes with real SSH env'
	},
	{
		name: 'V1 real VNC framebuffer verification',
		status: hasEnv('TERMIXKIT_ACCEPTANCE_REAL_VNC_PASSED') ? 'available' : 'blocked',
		evidence:
			'set TERMIXKIT_ACCEPTANCE_REAL_VNC_PASSED after npm run smoke:protocols passes with real VNC env'
	},
	{
		name: 'V1 real RDP through Devolutions Gateway',
		status: hasEnv('TERMIXKIT_ACCEPTANCE_REAL_RDP_PASSED') ? 'available' : 'blocked',
		evidence:
			'set TERMIXKIT_ACCEPTANCE_REAL_RDP_PASSED after npm run smoke:rdp-gateway passes with real Gateway/RDP env'
	},
	{
		name: 'V2 Microsoft Entra local parser and configuration smoke',
		status: 'local',
		evidence: 'npm run smoke:microsoft validates the local parser fixture without real Entra env'
	},
	{
		name: 'V2 real Microsoft Entra discovery and optional client credentials',
		status: hasEnv('TERMIXKIT_ACCEPTANCE_MICROSOFT_SMOKE_PASSED') ? 'available' : 'blocked',
		evidence:
			'set TERMIXKIT_ACCEPTANCE_MICROSOFT_SMOKE_PASSED after TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1 npm run smoke:microsoft passes with real Microsoft env'
	},
	{
		name: 'V2 Microsoft interactive login acceptance',
		status: hasEnv('TERMIXKIT_SMOKE_MICROSOFT_INTERACTIVE_PROOF') ? 'available' : 'blocked',
		evidence:
			'manual browser proof for allowed-domain session creation, blocked-domain denial, admin-email promotion, and local login still available'
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
	if (status === 'available') return '[env-ready]';
	if (status === 'manual') return '[manual]';
	return '[blocked]';
}

function hasEnv(name) {
	return Boolean(process.env[name]?.trim());
}
