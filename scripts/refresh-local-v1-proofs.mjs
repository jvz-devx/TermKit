import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';

const proofFilePath = process.env.TERMIXKIT_ACCEPTANCE_PROOF_FILE ?? 'acceptance-proof.local.json';
const sshHost = process.env.TERMIXKIT_LOCAL_PROOF_SSH_HOST?.trim() || 'localhost';
const sshUsername =
	process.env.TERMIXKIT_LOCAL_PROOF_SSH_USERNAME?.trim() || process.env.USER?.trim() || 'jens';
const sshPrivateKeyPath =
	process.env.TERMIXKIT_LOCAL_PROOF_SSH_PRIVATE_KEY_PATH?.trim() ||
	`${process.env.HOME}/.ssh/id_ed25519`;
const vncPort = parsePort('TERMIXKIT_LOCAL_PROOF_VNC_PORT', 5977);
const vncDisplay = process.env.TERMIXKIT_LOCAL_PROOF_VNC_DISPLAY?.trim() || ':77';
const rdpContainerImage =
	process.env.TERMIXKIT_LOCAL_PROOF_RDP_CONTAINER_IMAGE?.trim() ||
	(localDockerImageExists('guacd-rs-xrdp-test:latest') ? 'guacd-rs-xrdp-test:latest' : '');
const rdpHost = process.env.TERMIXKIT_LOCAL_PROOF_RDP_HOST?.trim() || '127.0.0.1';
const rdpPort = parsePort('TERMIXKIT_LOCAL_PROOF_RDP_PORT', rdpContainerImage ? 3390 : 3389);
const rdpUsername =
	process.env.TERMIXKIT_LOCAL_PROOF_RDP_USERNAME?.trim() ||
	(rdpContainerImage ? 'testuser' : sshUsername);
const rdpPassword =
	process.env.TERMIXKIT_LOCAL_PROOF_RDP_PASSWORD ?? (rdpContainerImage ? 'testpass' : '');
const gatewayPort = parsePort('TERMIXKIT_LOCAL_PROOF_GATEWAY_PORT', 7171);
const gatewayImage =
	process.env.TERMIXKIT_LOCAL_PROOF_GATEWAY_IMAGE?.trim() ||
	'devolutions/devolutions-gateway:2026.1.1';
const gatewayName = `termixkit-proof-gateway-${process.pid}`;
const rdpContainerName = `termixkit-proof-rdp-${process.pid}`;

const cleanup = [];
process.on('exit', runCleanup);
process.on('SIGINT', () => {
	process.exitCode = 130;
	process.exit();
});
process.on('SIGTERM', () => {
	process.exitCode = 143;
	process.exit();
});

await main();

async function main() {
	ensureCommand('ssh-keyscan');
	ensureCommand('ssh-keygen');
	ensureCommand('docker');
	ensureCommand('Xvnc');

	if (!existsSync(sshPrivateKeyPath)) {
		throw new Error(`SSH private key does not exist: ${sshPrivateKeyPath}`);
	}
	await ensurePortOpen(sshHost, 22, 'local SSH target');

	const fingerprint = sshFingerprint(sshHost);
	ensureFreshProofFile();
	resetLocalV1Proofs();
	run('nix', ['develop', '-c', 'npm', 'run', 'acceptance:record-real-ssh'], {
		TERMIXKIT_SMOKE_SSH_HOST: sshHost,
		TERMIXKIT_SMOKE_SSH_USERNAME: sshUsername,
		TERMIXKIT_SMOKE_SSH_PRIVATE_KEY_PATH: sshPrivateKeyPath,
		TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256: fingerprint,
		TERMIXKIT_SMOKE_SSH_COMMAND: 'printf termixkit-real-ssh-proof'
	});

	await withVncServer(async () => {
		run('nix', ['develop', '-c', 'npm', 'run', 'acceptance:record-real-vnc'], {
			TERMIXKIT_SMOKE_VNC_HOST: '127.0.0.1',
			TERMIXKIT_SMOKE_VNC_PORT: String(vncPort)
		});
	});

	await withRdpTarget(async () => {
		await ensurePortOpen(rdpHost, rdpPort, 'local RDP target');
		await withGateway(async () => {
			run('nix', ['develop', '-c', 'npm', 'run', 'acceptance:record-real-rdp'], {
				GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
				GATEWAY_PUBLIC_URL: 'http://127.0.0.1:3000/gateway',
				GATEWAY_PROVISIONER_SUBJECT: 'TermixKit',
				GATEWAY_PROVISIONER_KEY: 'termixkit-local-proof-key',
				TERMIXKIT_INSECURE_LOCAL_HTTP: '1',
				TERMIXKIT_SMOKE_RDP_HOST: rdpHost,
				TERMIXKIT_SMOKE_RDP_PORT: String(rdpPort),
				TERMIXKIT_SMOKE_RDP_USERNAME: rdpUsername,
				TERMIXKIT_SMOKE_RDP_PASSWORD: rdpPassword,
				TERMIXKIT_SMOKE_RDP_GATEWAY_TIMEOUT_MS: '30000'
			});
		});
	});

	run('nix', ['develop', '-c', 'npm', 'run', 'audit:acceptance'], {}, { allowExitCodes: [0, 2] });
}

async function withVncServer(callback) {
	const processHandle = startBackground('Xvnc', [
		vncDisplay,
		'-localhost',
		'-SecurityTypes',
		'None',
		'-rfbport',
		String(vncPort),
		'-geometry',
		'1024x768',
		'-depth',
		'24'
	]);
	cleanup.push(() => processHandle.kill('SIGTERM'));
	await waitForPort('127.0.0.1', vncPort, 'Xvnc');
	await callback();
	processHandle.kill('SIGTERM');
}

async function withRdpTarget(callback) {
	if (!rdpContainerImage) {
		await callback();
		return;
	}

	run('docker', [
		'run',
		'--rm',
		'-d',
		'--name',
		rdpContainerName,
		'-p',
		`127.0.0.1:${rdpPort}:3389`,
		rdpContainerImage
	]);
	cleanup.push(() => spawnSync('docker', ['rm', '-f', rdpContainerName], { stdio: 'ignore' }));
	await waitForPort('127.0.0.1', rdpPort, 'disposable RDP target');
	await callback();
	spawnSync('docker', ['rm', '-f', rdpContainerName], { stdio: 'ignore' });
}

async function withGateway(callback) {
	run('docker', [
		'run',
		'--rm',
		'-d',
		'--name',
		gatewayName,
		'-p',
		`127.0.0.1:${gatewayPort}:7171`,
		'-e',
		'DGW_LISTEN=0.0.0.0:7171',
		'-e',
		'DGW_SUBJECT=localhost',
		'-e',
		'WEB_APP_ENABLED=true',
		'-e',
		'WEB_APP_AUTHENTICATION=None',
		gatewayImage
	]);
	cleanup.push(() => spawnSync('docker', ['rm', '-f', gatewayName], { stdio: 'ignore' }));
	await waitForPort('127.0.0.1', gatewayPort, 'Devolutions Gateway');
	await callback();
	spawnSync('docker', ['rm', '-f', gatewayName], { stdio: 'ignore' });
}

function run(command, args, env = {}, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe']
	});

	if (result.stdout.trim()) console.log(result.stdout.trim());
	if (result.stderr.trim()) console.error(result.stderr.trim());
	const allowed = new Set(options.allowExitCodes ?? [0]);
	if (!allowed.has(result.status ?? 1)) {
		throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 1}`);
	}
}

function startBackground(command, args) {
	const child = spawn(command, args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	child.stdout.on('data', (chunk) => {
		output += chunk.toString();
	});
	child.stderr.on('data', (chunk) => {
		output += chunk.toString();
	});
	return {
		kill(signal) {
			if (!child.killed) child.kill(signal);
		},
		output() {
			return output.trim();
		}
	};
}

function ensureFreshProofFile() {
	if (!existsSync(proofFilePath)) {
		run('nix', ['develop', '-c', 'npm', 'run', 'acceptance:proof-template', '--', proofFilePath]);
		return;
	}

	const proofFile = readJson(proofFilePath);
	const commit = currentCommit();
	if (proofFile.commit !== commit) {
		run('nix', ['develop', '-c', 'npm', 'run', 'acceptance:proof-template', '--', proofFilePath]);
	}
}

function resetLocalV1Proofs() {
	const timestamp = new Date().toISOString();
	const proofFile = readJson(proofFilePath);
	proofFile.proofs ??= {};
	proofFile.proofs.realSsh = pendingProof(
		timestamp,
		'TERMIXKIT_SMOKE_SSH_HOST=<redacted> npm run smoke:protocols',
		[
			'TERMIXKIT_SMOKE_SSH_HOST',
			'TERMIXKIT_SMOKE_SSH_USERNAME',
			'TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256'
		]
	);
	proofFile.proofs.realVnc = pendingProof(
		timestamp,
		'TERMIXKIT_SMOKE_VNC_HOST=<redacted> npm run smoke:protocols',
		['TERMIXKIT_SMOKE_VNC_HOST', 'TERMIXKIT_SMOKE_VNC_PORT']
	);
	proofFile.proofs.realRdp = pendingProof(
		timestamp,
		'GATEWAY_URL=<redacted> TERMIXKIT_SMOKE_RDP_HOST=<redacted> npm run smoke:rdp-gateway',
		['GATEWAY_URL', 'GATEWAY_PUBLIC_URL', 'GATEWAY_PROVISIONER_KEY', 'TERMIXKIT_SMOKE_RDP_HOST']
	);
	writeFileSync(proofFilePath, `${JSON.stringify(proofFile, null, 2)}\n`);
}

function pendingProof(timestamp, command, redactedEnv) {
	return {
		passed: false,
		timestamp,
		command,
		instructions:
			'Pending refresh by npm run acceptance:refresh-local-v1-proofs. This entry is valid only after the matching real-target smoke is recorded again for the current commit.',
		redactedEnv,
		output: ''
	};
}

function sshFingerprint(host) {
	const scan = spawnSync('ssh-keyscan', ['-T', '5', '-t', 'ed25519', host], {
		encoding: 'utf8'
	});
	if (scan.status !== 0 || !scan.stdout.trim()) {
		throw new Error(`Could not scan SSH host key for ${host}`);
	}
	const keygen = spawnSync('ssh-keygen', ['-lf', '-', '-E', 'sha256'], {
		encoding: 'utf8',
		input: scan.stdout
	});
	if (keygen.status !== 0 || !keygen.stdout.trim()) {
		throw new Error(`Could not derive SSH fingerprint for ${host}`);
	}
	return keygen.stdout.trim().split(/\s+/)[1];
}

async function ensurePortOpen(host, port, label) {
	try {
		await waitForPort(host, port, label, 1_000);
	} catch {
		throw new Error(`${label} is not reachable at ${host}:${port}`);
	}
}

async function waitForPort(host, port, label, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await canConnect(host, port)) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} did not open ${host}:${port}`);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(`Could not read ${path}: ${errorText(error)}`, { cause: error });
	}
}

function currentCommit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return '<commit-sha>';
	}
}

function parsePort(envName, defaultValue) {
	const rawValue = process.env[envName]?.trim();
	if (!rawValue) return defaultValue;
	if (!/^\d+$/.test(rawValue)) {
		throw new Error(`${envName} must be an integer TCP port.`);
	}
	const value = Number(rawValue);
	if (!Number.isInteger(value) || value < 1 || value > 65_535) {
		throw new Error(`${envName} must be between 1 and 65535.`);
	}
	return value;
}

function canConnect(host, port) {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host, port });
		socket.setTimeout(500);
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
		socket.once('timeout', () => {
			socket.destroy();
			resolve(false);
		});
	});
}

function ensureCommand(command) {
	const result = spawnSync('sh', ['-c', `command -v ${quote(command)}`], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`${command} is required; run this inside nix develop.`);
}

function localDockerImageExists(image) {
	const result = spawnSync('docker', ['image', 'inspect', image], {
		encoding: 'utf8',
		stdio: 'ignore'
	});
	return result.status === 0;
}

function runCleanup() {
	for (const cleanupTask of cleanup.splice(0).reverse()) {
		try {
			cleanupTask();
		} catch {
			// Best-effort cleanup only.
		}
	}
}

function quote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
