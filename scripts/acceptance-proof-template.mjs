import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const commit = currentCommit();
const timestamp = new Date().toISOString();
const outputPath = process.argv[2];

const template = `${JSON.stringify(
	{
		commit,
		generatedAt: timestamp,
		proofs: {
			realSsh: {
				passed: false,
				timestamp,
				command: 'TERMIXKIT_SMOKE_SSH_HOST=... npm run smoke:protocols',
				redactedEnv: [
					'TERMIXKIT_SMOKE_SSH_HOST',
					'TERMIXKIT_SMOKE_SSH_USERNAME',
					'TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256'
				],
				output: ''
			},
			realVnc: {
				passed: false,
				timestamp,
				command: 'TERMIXKIT_SMOKE_VNC_HOST=... npm run smoke:protocols',
				redactedEnv: ['TERMIXKIT_SMOKE_VNC_HOST', 'TERMIXKIT_SMOKE_VNC_PORT'],
				output: ''
			},
			realRdp: {
				passed: false,
				timestamp,
				command: 'npm run smoke:rdp-gateway',
				redactedEnv: [
					'GATEWAY_URL',
					'GATEWAY_PUBLIC_URL',
					'GATEWAY_PROVISIONER_KEY',
					'TERMIXKIT_SMOKE_RDP_HOST'
				],
				output: ''
			},
			realFtp: {
				passed: false,
				timestamp,
				command:
					'TERMIXKIT_REAL_FTP_HOST=<redacted> TERMIXKIT_REAL_FTP_EVIDENCE_ID=<redacted> TERMIXKIT_REAL_FTP_PROOF_NOTES=<redacted> npm run acceptance:record-real-ftp',
				instructions:
					'Record only after testing a real FTP target outside local fixtures. Notes must include the exact fragments ftp login, ftp list, ftp download, ftp upload, ftp mkdir, ftp rename, ftp delete, ftp text edit, and connection history. Do not store target credentials, session tokens, or cookies.',
				redactedEnv: [
					'TERMIXKIT_REAL_FTP_HOST',
					'TERMIXKIT_REAL_FTP_PORT',
					'TERMIXKIT_REAL_FTP_USERNAME',
					'TERMIXKIT_REAL_FTP_EVIDENCE_ID'
				],
				evidenceId: '',
				notes: '',
				output: ''
			},
			realFtps: {
				passed: false,
				timestamp,
				command:
					'TERMIXKIT_REAL_FTPS_HOST=<redacted> TERMIXKIT_REAL_FTPS_EVIDENCE_ID=<redacted> TERMIXKIT_REAL_FTPS_PROOF_NOTES=<redacted> npm run acceptance:record-real-ftps',
				instructions:
					'Record only after testing a real FTPS target outside local fixtures. Notes must include the exact fragments ftps login, ftps tls, ftps certificate, ftps list, ftps download, ftps upload, ftps mkdir, ftps rename, ftps delete, ftps text edit, and connection history. Do not store target credentials, session tokens, or cookies.',
				redactedEnv: [
					'TERMIXKIT_REAL_FTPS_HOST',
					'TERMIXKIT_REAL_FTPS_PORT',
					'TERMIXKIT_REAL_FTPS_USERNAME',
					'TERMIXKIT_REAL_FTPS_MODE',
					'TERMIXKIT_REAL_FTPS_CERTIFICATE_POLICY',
					'TERMIXKIT_REAL_FTPS_EVIDENCE_ID'
				],
				evidenceId: '',
				notes: '',
				output: ''
			},
			microsoftSmoke: {
				passed: false,
				timestamp,
				command: 'TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1 npm run smoke:microsoft',
				instructions:
					'Prefer npm run acceptance:record-microsoft-smoke after exporting real Microsoft Entra environment variables. Put only redacted pass output here; never store tenant secrets, authorization codes, access tokens, refresh tokens, ID tokens, or cookies.',
				redactedEnv: [
					'MICROSOFT_AUTH_ENABLED',
					'MICROSOFT_TENANT_ID',
					'MICROSOFT_CLIENT_ID',
					'MICROSOFT_CLIENT_SECRET',
					'MICROSOFT_ALLOWED_DOMAINS',
					'MICROSOFT_ADMIN_EMAILS'
				],
				output: ''
			},
			microsoftInteractive: {
				passed: false,
				timestamp,
				command: 'manual browser acceptance',
				instructions:
					'Prefer npm run acceptance:record-microsoft-interactive after collecting real browser evidence. Record redacted operator notes or screenshot references proving allowed-domain session creation, blocked-domain denial, admin-email provisioning or promotion, and local login still available. The notes or output field must include the exact fragments allowed-domain, blocked-domain, admin-email, and local login.',
				redactedEnv: [
					'MICROSOFT_TENANT_ID',
					'MICROSOFT_CLIENT_ID',
					'MICROSOFT_ALLOWED_DOMAINS',
					'MICROSOFT_ADMIN_EMAILS'
				],
				notes: '',
				output: ''
			}
		}
	},
	null,
	2
)}\n`;

if (outputPath) {
	writeFileSync(outputPath, template);
} else {
	process.stdout.write(template);
}

function currentCommit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return '<commit-sha>';
	}
}
