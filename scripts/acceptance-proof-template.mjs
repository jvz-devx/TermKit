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
			microsoftSmoke: {
				passed: false,
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
				output: ''
			},
			microsoftInteractive: {
				passed: false,
				timestamp,
				command: 'manual browser acceptance',
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
