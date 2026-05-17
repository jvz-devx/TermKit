import { spawn, execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import postgres from 'postgres';
import { WebSocket } from 'ws';
import { createFileFixtureHelpers } from './smoke-app-file-fixtures.mjs';
import {
	createTelnetFixtureServer,
	createVncFixtureServer,
	describeVncState,
	IAC,
	NAWS,
	rfbVersion,
	SB,
	SE,
	WILL
} from './smoke-app-terminal-fixtures.mjs';
import {
	bufferIncludes,
	closeServer,
	createSmokeRuntime,
	delay,
	errorText,
	findAvailablePort,
	formatLogs,
	listen,
	readJsonBody,
	runCleanup,
	stopChild,
	writeJson,
	writeText
} from './smoke-app-runtime.mjs';

const require = createRequire(import.meta.url);
const { Server: SshServer, utils } = require('ssh2');
const execFile = promisify(execFileCallback);
const { createFtpFixtureServer, installSftpFixtureServer } = createFileFixtureHelpers(
	utils.sftp.STATUS_CODE
);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builtServerEntry = resolve(root, 'build/server.js');
const timeoutMs = Number(process.env.TERMIXKIT_SMOKE_APP_TIMEOUT_MS ?? 15_000);
const postgresImage = process.env.TERMIXKIT_SMOKE_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const postgresUser = 'termixkit';
const postgresPassword = 'termixkit_app_smoke_password';
const postgresDb = 'termixkit_app_smoke';
const smokeUsername = process.env.TERMIXKIT_SMOKE_APP_USERNAME ?? 'smoke-admin';
const smokePassword =
	process.env.TERMIXKIT_SMOKE_APP_PASSWORD ?? `Smoke-Admin-${process.pid}-${Date.now()}!`;

const cleanup = [];
const results = [];
let appProcess;
let appLogs;
let postgresContainerName;
let tempDir;

const { runChecked, waitForHttp, waitFor } = createSmokeRuntime({ root, timeoutMs });

try {
	if (
		!process.env.TERMIXKIT_SMOKE_APP_BASE_URL &&
		process.env.TERMIXKIT_SMOKE_APP_SKIP_BUILD !== '1'
	) {
		await runChecked('npm', ['run', 'build'], process.env);
	}

	if (!process.env.TERMIXKIT_SMOKE_APP_BASE_URL && !existsSync(builtServerEntry)) {
		throw new Error('build/server.js is missing. Run npm run build before this smoke test.');
	}

	tempDir = await mkdtemp(join(tmpdir(), 'termixkit-app-smoke-'));
	cleanup.push(() => rm(tempDir, { recursive: true, force: true }));

	const fixtures = await startProtocolFixtures();
	cleanup.push(fixtures.close);
	pass('local protocol fixtures', fixtures.summary);

	const gateway = process.env.TERMIXKIT_SMOKE_APP_BASE_URL ? null : await startMockRdpGateway();
	if (gateway) {
		cleanup.push(gateway.close);
		pass('mock RDP Gateway', gateway.url);
	}

	const app = await startOrUseApp(gateway?.url);
	cleanup.push(app.close);
	pass('built app ready', app.baseUrl);

	const auth = await createAndLoginAdmin(app.baseUrl);
	cleanup.push(auth.close);
	pass(
		'create/login admin',
		auth.createdAdmin ? `created ${smokeUsername}` : `logged in as ${smokeUsername}`
	);

	const api = createApiClient(app.baseUrl, auth.cookieHeader);
	const credential = await createSshCredential(api);
	const sshHost = await createHost(api, {
		name: 'Smoke SSH fixture A',
		protocol: 'ssh',
		hostname: '127.0.0.1',
		port: fixtures.sshPort,
		username: 'smoke',
		credentialId: credential.id,
		tags: ['smoke']
	});
	pass('create SSH credential/host', `${credential.id} / ${sshHost.id}`);

	await smokeSshWebSocket(api, app.baseUrl, auth.cookieHeader, sshHost.id);
	pass('SSH websocket shell', 'saw ssh-ready and ssh-echo:smoke-shell');

	await smokeLiveSshSessionUi(auth.page, app.baseUrl, sshHost.id);
	pass(
		'Live SSH workspace tabs',
		'created multiple tabs, reattached after refresh/new context, and closed from UI'
	);

	await smokeSftpApi(api, sshHost.id);
	pass(
		'SFTP API file workflow',
		'verified list, download, upload, mkdir, text read/write, rename/move, and delete'
	);
	await smokeSftpWorkspaceUi(auth.page, sshHost.id, app.databaseUrl);
	pass(
		'SFTP browser file workflow',
		'created and ended SFTP connection session while driving list/search/navigation, mkdir, text read/write, rename, upload, download, and delete'
	);

	const ftpCredential = await createFtpCredential(api);
	const ftpHost = await createHost(api, {
		name: 'Smoke FTP fixture',
		protocol: 'ftp',
		hostname: '127.0.0.1',
		port: fixtures.ftpPort,
		username: 'ftp-smoke',
		credentialId: ftpCredential.id,
		tags: ['smoke', 'files']
	});
	const ftpsHost = await createHost(api, {
		name: 'Smoke FTPS fixture',
		protocol: 'ftps',
		hostname: '127.0.0.1',
		port: fixtures.ftpsPort,
		username: 'ftp-smoke',
		credentialId: ftpCredential.id,
		tags: ['smoke', 'files', 'tls'],
		metadata: {
			ftps: {
				mode: 'explicit',
				rejectUnauthorized: false,
				certificateHostname: '127.0.0.1'
			}
		}
	});
	await smokeFtpApi(api, ftpHost.id, 'ftp');
	pass(
		'FTP API file workflow',
		'verified list, download, upload, mkdir, text read/write, rename/move, and delete'
	);
	await smokeFtpWorkspaceUi(auth.page, ftpHost.id, 'ftp', app.databaseUrl);
	pass(
		'FTP browser file workflow',
		'created and ended FTP connection session while driving list/search/navigation, mkdir, text read/write, rename, upload, download, and delete'
	);
	await smokeFtpApi(api, ftpsHost.id, 'ftps');
	await waitFor(
		() => fixtures.ftpsState.authTlsCount > 0,
		'FTPS fixture did not negotiate AUTH TLS.'
	);
	await waitFor(
		() => fixtures.ftpsState.protectedTransferCount > 0,
		'FTPS fixture did not receive a protected data transfer.'
	);
	pass(
		'FTPS API file workflow',
		'verified explicit TLS negotiation plus list, download, upload, text, rename/move, and delete'
	);
	await smokeFtpWorkspaceUi(auth.page, ftpsHost.id, 'ftps', app.databaseUrl);
	pass(
		'FTPS browser file workflow',
		'created and ended FTPS connection session while driving list/search/navigation, mkdir, text read/write, rename, upload, download, and delete through explicit FTPS'
	);

	const telnetHost = await createHost(api, {
		name: 'Smoke Telnet fixture',
		protocol: 'telnet',
		hostname: '127.0.0.1',
		port: fixtures.telnetPort,
		tags: ['smoke']
	});
	await smokeTelnetWebSocket(
		api,
		app.baseUrl,
		auth.cookieHeader,
		telnetHost.id,
		fixtures.telnetState
	);
	pass('Telnet websocket with NAWS', 'saw telnet-ready, echo, and 132x43 NAWS');
	await smokeTelnetBrowserUi(auth.page, telnetHost.id, fixtures.telnetState);
	pass(
		'Telnet browser terminal workflow',
		'sent terminal command through browser controls, fixture saw browser input/NAWS, and UI close/reconnect opened a fresh Telnet session'
	);

	const vncCredential = await createVncCredential(api);
	const vncHost = await createHost(api, {
		name: 'Smoke VNC fixture',
		protocol: 'vnc',
		hostname: '127.0.0.1',
		port: fixtures.vncPort,
		username: 'vnc-user',
		credentialId: vncCredential.id,
		tags: ['smoke']
	});
	await smokeVncSavedCredentialLaunchUi(
		auth.page,
		vncHost.id,
		fixtures.vncState,
		fixtures.closeVncClients
	);
	pass(
		'VNC browser launch/reconnect',
		'staged saved password, noVNC reached the local RFB fixture, handled disconnect, reconnected, and did not render the secret'
	);
	await smokeVncWebSocket(api, app.baseUrl, auth.cookieHeader, vncHost.id, fixtures.vncState);
	pass('VNC websocket RFB banner', 'proxied RFB 003.008 banner');

	if (gateway) {
		const rdpCredential = await createRdpCredential(api);
		const rdpHost = await createHost(api, {
			name: 'Smoke RDP fixture',
			protocol: 'rdp',
			hostname: 'windows.example.test',
			port: 3389,
			username: 'host-rdp-user',
			credentialId: rdpCredential.id,
			tags: ['smoke']
		});
		await smokeRdpSessionLaunchUi(auth.page, app.baseUrl, auth.cookieHeader, rdpHost.id, gateway);
		pass(
			'RDP remote launch controls',
			'staged saved password, showed clipboard controls, verified the server-side RDP JET proxy without app cookies, and reconnected through the mock Gateway'
		);
	} else {
		pass('RDP remote launch boundary', 'skipped for externally managed app');
	}

	printResults(console.log);
} catch (error) {
	printResults(console.error);
	if (appLogs) console.error(formatLogs(appLogs));
	console.error(error instanceof Error ? error.stack || error.message : error);
	process.exitCode = 1;
} finally {
	await runCleanup(cleanup);
}

process.exit(process.exitCode ?? 0);

function pass(name, detail) {
	results.push({ status: '[pass]', name, detail });
}

function printResults(write) {
	for (const result of results) {
		const suffix = result.detail ? ` - ${result.detail}` : '';
		write(`${result.status} ${result.name}${suffix}`);
	}
}

async function startOrUseApp(gatewayUrl) {
	const existingBaseUrl = process.env.TERMIXKIT_SMOKE_APP_BASE_URL;
	if (existingBaseUrl) {
		return {
			baseUrl: existingBaseUrl.replace(/\/$/, ''),
			databaseUrl: process.env.TERMIXKIT_SMOKE_DATABASE_URL ?? process.env.DATABASE_URL ?? null,
			close: async () => {}
		};
	}

	const databaseUrl = process.env.TERMIXKIT_SMOKE_DATABASE_URL ?? (await startIsolatedPostgres());
	await runMigrations(databaseUrl);

	const port = Number(process.env.TERMIXKIT_SMOKE_APP_PORT ?? (await findAvailablePort()));
	const baseUrl = `http://127.0.0.1:${port}`;
	const logs = { stdout: '', stderr: '' };
	appLogs = logs;
	const appEnv = {
		...process.env,
		NODE_ENV: 'production',
		HOST: '127.0.0.1',
		PORT: String(port),
		ORIGIN: baseUrl,
		TERMIXKIT_INSECURE_LOCAL_HTTP: '1',
		BODY_SIZE_LIMIT: process.env.BODY_SIZE_LIMIT ?? '55M',
		DATABASE_URL: databaseUrl,
		APP_SECRET: process.env.APP_SECRET ?? 'B8dF1hJ3kL5mN7pR9tV2wX4yZ6aC8eG0',
		CREDENTIAL_MASTER_KEY: process.env.CREDENTIAL_MASTER_KEY ?? 'H7jK9mN2pQ4rS6tV8wX0yZ1aB3cD5eF6',
		TERMIXKIT_SSH_KNOWN_HOSTS_PATH:
			process.env.TERMIXKIT_SSH_KNOWN_HOSTS_PATH ?? join(tempDir, 'ssh-known-hosts.json'),
		TERMIXKIT_SSH_TRUST_ON_FIRST_USE: process.env.TERMIXKIT_SSH_TRUST_ON_FIRST_USE ?? '1',
		TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU: process.env.TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU ?? '1',
		GATEWAY_URL: process.env.GATEWAY_URL ?? gatewayUrl ?? 'http://127.0.0.1:7171',
		GATEWAY_PUBLIC_URL: process.env.GATEWAY_PUBLIC_URL ?? `${baseUrl}/gateway`,
		GATEWAY_PROVISIONER_KEY: process.env.GATEWAY_PROVISIONER_KEY ?? 'app-smoke-local-key'
	};

	appProcess = spawn(process.execPath, ['--input-type=module', '--eval', productionStartSource()], {
		cwd: root,
		env: appEnv,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	appProcess.stdout.setEncoding('utf8');
	appProcess.stderr.setEncoding('utf8');
	appProcess.stdout.on('data', (chunk) => {
		logs.stdout += chunk;
	});
	appProcess.stderr.on('data', (chunk) => {
		logs.stderr += chunk;
	});

	await waitForHttp(baseUrl, appProcess, logs);
	return {
		baseUrl,
		databaseUrl,
		close: () => stopChild(appProcess)
	};
}

function productionStartSource() {
	return [
		"import { validateProductionEnv } from './scripts/validate-production-env.mjs';",
		'validateProductionEnv();',
		"const serverModule = await import('./build/server.js');",
		"if (typeof serverModule.startTermixServer === 'function') {",
		'  await serverModule.startTermixServer(process.env);',
		'} else {',
		"  await import('./scripts/start-production.mjs');",
		'}'
	].join('\n');
}

async function startIsolatedPostgres() {
	postgresContainerName = `termixkit-app-smoke-${process.pid}-${Date.now()}`;
	cleanup.push(async () => {
		if (!postgresContainerName) return;
		await execFile('docker', ['stop', '--time', '5', postgresContainerName]).catch(() => {});
	});

	await execFile('docker', [
		'run',
		'--detach',
		'--rm',
		'--name',
		postgresContainerName,
		'--publish',
		'127.0.0.1::5432',
		'--env',
		`POSTGRES_USER=${postgresUser}`,
		'--env',
		`POSTGRES_PASSWORD=${postgresPassword}`,
		'--env',
		`POSTGRES_DB=${postgresDb}`,
		postgresImage
	]);
	await writeFile(join(tempDir, 'postgres-container'), postgresContainerName, 'utf8');

	const hostPort = await readPostgresPort(postgresContainerName);
	await waitForPostgres(postgresContainerName);
	return `postgres://${postgresUser}:${postgresPassword}@127.0.0.1:${hostPort}/${postgresDb}`;
}

async function readPostgresPort(name) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { stdout } = await execFile('docker', ['port', name, '5432/tcp']);
		const port = /:(\d+)$/.exec(stdout.trim().split('\n')[0])?.[1];
		if (port) return port;
		await delay(250);
	}
	throw new Error('Timed out waiting for isolated Postgres port mapping.');
}

async function waitForPostgres(name) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await execFile('docker', ['exec', name, 'pg_isready', '-U', postgresUser, '-d', postgresDb]);
			return;
		} catch {
			await delay(500);
		}
	}
	throw new Error('Timed out waiting for isolated Postgres to become healthy.');
}

async function runMigrations(databaseUrl) {
	if (process.env.TERMIXKIT_SMOKE_SKIP_MIGRATIONS === '1') return;
	const attempts = Number(process.env.TERMIXKIT_SMOKE_MIGRATION_ATTEMPTS ?? '5');
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			await runChecked(process.execPath, ['scripts/migrate.mjs'], {
				...process.env,
				DATABASE_URL: databaseUrl
			});
			return;
		} catch (error) {
			if (attempt === attempts) throw error;
			console.warn(`Drizzle migration attempt ${attempt} failed; retrying.`);
			await delay(1_000);
		}
	}
}

async function createAndLoginAdmin(baseUrl) {
	const context = await chromium.launchPersistentContext(join(tempDir, 'chromium-profile'), {
		headless: true,
		executablePath: await chromiumExecutablePath(),
		baseURL: baseUrl,
		args: ['--no-first-run', '--disable-default-apps']
	});
	const page = await context.newPage();
	let createdAdmin = false;

	await page.goto('/first-run');
	if (
		await page
			.getByRole('heading', { name: 'Create admin' })
			.isVisible()
			.catch(() => false)
	) {
		await page.getByLabel('Username').fill(smokeUsername);
		await page.getByLabel('Password', { exact: true }).fill(smokePassword);
		await page.getByLabel('Confirm password').fill(smokePassword);
		await page.getByRole('button', { name: 'Create admin' }).click();
		await page.waitForURL(/\/hosts$/, { timeout: timeoutMs });
		createdAdmin = true;
	}

	await context.clearCookies();
	await page.goto('/login');
	await page.getByLabel('Username').fill(smokeUsername);
	await page.getByLabel('Password').fill(smokePassword);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(/\/hosts$/, { timeout: timeoutMs });

	const cookieHeader = (await context.cookies(baseUrl))
		.map((cookie) => `${cookie.name}=${cookie.value}`)
		.join('; ');
	if (!cookieHeader.includes('termixkit_session=')) {
		throw new Error('Login did not produce a termixkit_session cookie.');
	}

	return {
		createdAdmin,
		page,
		cookieHeader,
		close: () => context.close()
	};
}

async function chromiumExecutablePath() {
	if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
		return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	}

	for (const command of ['google-chrome', 'chromium', 'chromium-browser', 'chrome']) {
		try {
			const { stdout } = await execFile('sh', ['-lc', `command -v ${command}`]);
			const path = stdout.trim();
			if (path) return path;
		} catch {
			// Try the next common browser command before falling back to Playwright defaults.
		}
	}

	return undefined;
}

function createApiClient(baseUrl, cookieHeader) {
	return {
		get: (path) => requestJson(baseUrl, cookieHeader, 'GET', path),
		post: (path, body) => requestJson(baseUrl, cookieHeader, 'POST', path, body),
		put: (path, body) => requestJson(baseUrl, cookieHeader, 'PUT', path, body),
		delete: (path) => requestJson(baseUrl, cookieHeader, 'DELETE', path),
		download: async (path) => {
			const response = await fetch(new URL(path, baseUrl), {
				headers: { cookie: cookieHeader }
			});
			await assertResponse(response, path);
			return Buffer.from(await response.arrayBuffer());
		},
		upload: async (path, name, data) => {
			const form = new FormData();
			form.append('file', new Blob([data]), name);
			const response = await fetch(new URL(path, baseUrl), {
				method: 'POST',
				headers: { cookie: cookieHeader, origin: new URL(baseUrl).origin },
				body: form
			});
			await assertResponse(response, path);
			return response.json();
		}
	};
}

async function requestJson(baseUrl, cookieHeader, method, path, body) {
	const response = await fetch(new URL(path, baseUrl), {
		method,
		headers: {
			cookie: cookieHeader,
			origin: new URL(baseUrl).origin,
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	await assertResponse(response, path);
	return response.json();
}

async function assertResponse(response, path) {
	if (response.ok) return;
	const body = await response.text().catch(() => '<unreadable>');
	throw new Error(`${path} returned ${response.status} ${response.statusText}: ${body}`);
}

async function createSshCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke SSH password',
		kind: 'password',
		username: 'smoke',
		secret: 'smoke-password'
	});
	return credential;
}

async function createRdpCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke RDP password',
		kind: 'password',
		username: 'saved-rdp-user',
		secret: 'saved-rdp-password'
	});
	return credential;
}

async function createVncCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke VNC password',
		kind: 'password',
		username: 'saved-vnc-user',
		secret: 'saved-vnc-password'
	});
	return credential;
}

async function createFtpCredential(api) {
	const { credential } = await api.post('/api/credentials', {
		name: 'Smoke FTP password',
		kind: 'password',
		username: 'ftp-smoke',
		secret: 'ftp-smoke-password'
	});
	return credential;
}

async function createHost(api, input) {
	const { host } = await api.post('/api/hosts', input);
	return host;
}

async function smokeVncSavedCredentialLaunchUi(page, hostId, vncState, closeVncClients) {
	const launchPage = await page.context().newPage();
	const initialAuthResponseCount = vncState.authResponseCount;
	const initialCloseCount = vncState.closedCount;

	try {
		await launchPage.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=vnc`);
		await waitFor(
			async () =>
				((await launchPage.locator('body').textContent()) ?? '').includes(
					'saved password staged in browser memory'
				),
			async () => {
				const bodyText = ((await launchPage.locator('body').textContent()) ?? '')
					.replace(/\s+/g, ' ')
					.trim();
				return `VNC launch UI did not show saved-password staging state: ${bodyText}`;
			}
		);
		const bodyText = (await launchPage.locator('body').textContent()) ?? '';
		assert(!bodyText.includes('saved-vnc-password'), 'VNC pane rendered the saved password');
		await waitFor(
			() => vncState.authResponseCount > initialAuthResponseCount,
			() =>
				`VNC fixture did not receive a password-auth response from noVNC. ${describeVncState(vncState)}`
		);

		closeVncClients();
		await waitFor(
			() => vncState.closedCount > initialCloseCount,
			'VNC fixture client did not close after forced disconnect.'
		);
		await waitFor(
			async () => {
				const bodyText = (await launchPage.locator('body').textContent()) ?? '';
				return bodyText.includes('VNC not connected') && bodyText.includes('VNC session closed.');
			},
			async () => {
				const bodyText = ((await launchPage.locator('body').textContent()) ?? '')
					.replace(/\s+/g, ' ')
					.trim();
				return `VNC UI did not show disconnected state after fixture close: ${bodyText}`;
			}
		);

		const beforeReconnectAuthCount = vncState.authResponseCount;
		await launchPage.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await waitFor(
			() => vncState.authResponseCount > beforeReconnectAuthCount,
			() =>
				`VNC fixture did not receive a second auth response after reconnect. ${describeVncState(vncState)}`
		);
		const reconnectedBodyText = (await launchPage.locator('body').textContent()) ?? '';
		assert(
			!reconnectedBodyText.includes('saved-vnc-password'),
			'VNC pane rendered the saved password after reconnect'
		);
	} finally {
		await launchPage.close().catch(() => {});
	}
}

async function smokeRdpSessionLaunchUi(page, baseUrl, cookieHeader, hostId, gateway) {
	const initialGatewayRequests = gateway.requests.length;
	const launchPage = await page.context().newPage();

	try {
		await launchPage.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=rdp`);
		await waitFor(
			() => gateway.requests.length >= initialGatewayRequests + 2,
			async () => {
				const bodyText = ((await launchPage.locator('body').textContent()) ?? '')
					.replace(/\s+/g, ' ')
					.trim();
				return `RDP launch did not provision a Gateway association token. ${launchPage.url()} ${bodyText}`;
			}
		);

		try {
			await launchPage
				.getByText('Saved RDP password is staged for this tab and will be cleared after connect.')
				.waitFor({ timeout: timeoutMs });
		} catch (error) {
			const bodyText = ((await launchPage.locator('body').textContent()) ?? '')
				.replace(/\s+/g, ' ')
				.trim();
			throw new Error(`RDP launch UI did not show staged saved credentials: ${bodyText}`, {
				cause: error
			});
		}

		const proxyResponse = await fetch(new URL('/gateway/jet/rdp?association=1', baseUrl), {
			headers: {
				cookie: cookieHeader,
				origin: new URL(baseUrl).origin
			}
		});
		await assertResponse(proxyResponse, '/gateway/jet/rdp?association=1');
		const proxyBody = await proxyResponse.json();
		assert(proxyBody.ok === true, 'RDP app proxy did not return the Gateway response');
		await waitFor(
			async () => {
				const bodyText = (await launchPage.locator('body').textContent()) ?? '';
				return bodyText.includes('Clipboard on') && bodyText.includes('Text clipboard allowed.');
			},
			async () => {
				const bodyText = ((await launchPage.locator('body').textContent()) ?? '')
					.replace(/\s+/g, ' ')
					.trim();
				return `RDP launch UI did not expose clipboard policy controls: ${bodyText}`;
			}
		);

		const requests = gateway.requests.slice(initialGatewayRequests);
		assert(requests[0]?.path === '/jet/webapp/app-token', 'missing RDP app-token request');
		assert(requests[1]?.path === '/jet/webapp/session-token', 'missing RDP session-token request');
		assert(requests[2]?.path === '/jet/rdp', 'missing RDP JET proxy request');
		assert(requests[2]?.query === '?association=1', 'RDP JET proxy dropped the query string');
		assert(requests[2]?.headers?.cookie === undefined, 'RDP JET proxy forwarded app cookies');
		assert(
			requests[1]?.body?.destination === 'tcp://windows.example.test:3389',
			'RDP launch provisioned the wrong destination'
		);
		assert(
			!JSON.stringify(requests).includes('saved-rdp-password'),
			'RDP launch leaked saved password to Gateway provisioning'
		);
		const bodyText = (await launchPage.locator('body').textContent()) ?? '';
		assert(!bodyText.includes('saved-rdp-password'), 'RDP pane rendered the saved password');

		const beforeReconnectRequests = gateway.requests.length;
		await launchPage.getByRole('button', { name: 'Close session', exact: true }).click();
		await waitFor(
			async () => {
				const closedText = (await launchPage.locator('body').textContent()) ?? '';
				return (
					closedText.includes('RDP launch failed') &&
					closedText.includes('Disconnected. Reconnect to create a new session.')
				);
			},
			async () => {
				const closedText = ((await launchPage.locator('body').textContent()) ?? '')
					.replace(/\s+/g, ' ')
					.trim();
				return `RDP UI did not show local disconnected state: ${closedText}`;
			}
		);
		await launchPage.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await waitFor(
			() => gateway.requests.length >= beforeReconnectRequests + 2,
			'RDP reconnect did not provision a fresh Gateway association token.'
		);
		const reconnectRequests = gateway.requests.slice(beforeReconnectRequests);
		assert(
			reconnectRequests[0]?.path === '/jet/webapp/app-token',
			'missing RDP reconnect app-token request'
		);
		assert(
			reconnectRequests[1]?.path === '/jet/webapp/session-token',
			'missing RDP reconnect session-token request'
		);
		assert(
			reconnectRequests.every((request) => request.headers?.cookie === undefined),
			'RDP reconnect forwarded app cookies to Gateway provisioning'
		);
		assert(
			!JSON.stringify(reconnectRequests).includes('saved-rdp-password'),
			'RDP reconnect leaked saved password to Gateway provisioning'
		);
	} finally {
		await launchPage.close().catch(() => {});
	}
}

async function createTicket(api, hostId, protocol) {
	const { ticket } = await api.post('/api/session-tickets', { hostId, protocol, ttlMs: 60_000 });
	if (!ticket) throw new Error(`Session ticket API did not return a ticket for ${protocol}.`);
	return ticket;
}

async function smokeSshWebSocket(api, baseUrl, cookieHeader, hostId) {
	const ticket = await createTicket(api, hostId, 'ssh');
	const socket = await openWebSocket(
		baseUrl,
		`/ws/ssh/${encodeURIComponent(ticket)}`,
		cookieHeader
	);
	let output = '';
	let sentProbe = false;

	try {
		await waitForSocketCondition(socket, 'SSH shell output', (data) => {
			output += data.toString('utf8');
			if (!sentProbe && output.includes('ssh-ready')) {
				sentProbe = true;
				socket.send(JSON.stringify({ type: 'terminal.resize', cols: 120, rows: 40 }));
				socket.send(Buffer.from('smoke-shell\n'));
			}
			return output.includes('ssh-echo:smoke-shell');
		});
	} finally {
		socket.close();
	}
}

async function smokeLiveSshSessionUi(page, baseUrl, primaryHostId) {
	const livePage = await page.context().newPage();
	let detachedBrowser;
	const primaryTitle = 'Smoke SSH fixture A';
	const secondTitle = 'Smoke SSH fixture A 2';

	try {
		await createLiveSshTab(livePage, primaryHostId, primaryTitle);
		await createLiveSshTab(livePage, primaryHostId, secondTitle);
		await waitForLiveSshTabCount(livePage, 2);

		await livePage.reload();
		await attachLiveSshTab(livePage, secondTitle, {
			message: 'Live SSH tab did not reattach after browser refresh.'
		});

		detachedBrowser = await openDetachedBrowserContext(page, baseUrl);
		await detachedBrowser.page.goto(`/sessions?host=${encodeURIComponent(primaryHostId)}&tab=ssh`);
		await attachLiveSshTab(detachedBrowser.page, primaryTitle, {
			message: 'Live SSH tab did not reattach from a separate browser context.'
		});

		await closeLiveSshTab(detachedBrowser.page, primaryTitle);
		await closeLiveSshTab(detachedBrowser.page, secondTitle);
	} finally {
		await detachedBrowser?.close().catch(() => {});
		await livePage.close().catch(() => {});
	}
}

async function createLiveSshTab(page, hostId, title) {
	await page.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=ssh`);
	await page.getByRole('button', { name: 'Create persistent SSH tab', exact: true }).click();
	await waitForLiveSshTab(page, title);
	await waitForLiveSshAttach(page, `Live SSH terminal for ${title} did not attach.`);
}

async function attachLiveSshTab(page, title, { message }) {
	await waitForLiveSshTab(page, title);
	await liveSshTabRow(page, title).locator('button').first().click();
	await waitForLiveSshAttach(page, message);
}

async function closeLiveSshTab(page, title) {
	await waitForLiveSshTab(page, title);
	await liveSshTabRow(page, title)
		.getByRole('button', { name: `Close SSH tab ${title}`, exact: true })
		.click();
	await waitFor(
		async () => (await liveSshTabRow(page, title).count()) === 0,
		`Live SSH tab ${title} was not removed after closing.`
	);
}

async function waitForLiveSshTab(page, title) {
	await waitFor(
		async () => (await liveSshTabRow(page, title).count()) > 0,
		`Live SSH tab ${title} did not appear.`
	);
}

async function waitForLiveSshTabCount(page, expectedCount) {
	await waitFor(
		async () => (await page.locator('[data-active]').count()) >= expectedCount,
		`Live SSH tab strip did not show ${expectedCount} sessions.`
	);
}

async function waitForLiveSshAttach(page, message) {
	await waitFor(async () => {
		const bodyText = (await page.locator('body').textContent()) ?? '';
		return bodyText.includes('Attaching live SSH session...');
	}, 'Live SSH terminal did not switch to the live websocket path.');
	await waitFor(async () => {
		const bodyText = (await page.locator('body').textContent()) ?? '';
		return bodyText.includes('ssh-ready');
	}, message);
}

function liveSshTabRow(page, title) {
	return page.locator(`[data-live-ssh-tab-title="${cssAttributeValue(title)}"]`);
}

function cssAttributeValue(value) {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function openDetachedBrowserContext(page, baseUrl) {
	const browser = await chromium.launch({
		headless: true,
		executablePath: await chromiumExecutablePath(),
		args: ['--no-first-run', '--disable-default-apps']
	});
	const context = await browser.newContext({
		baseURL: baseUrl,
		storageState: await page.context().storageState()
	});

	return {
		page: await context.newPage(),
		close: () => browser.close()
	};
}

async function smokeSftpApi(api, hostId) {
	const list = await api.get(`/api/sftp/${encodeURIComponent(hostId)}/list?path=/`);
	const names = list.entries.map((entry) => entry.name);
	if (!names.includes('smoke.txt')) {
		throw new Error(`SFTP list did not include smoke.txt; saw ${names.join(', ') || '<empty>'}.`);
	}

	const downloaded = await api.download(
		`/api/sftp/${encodeURIComponent(hostId)}/download?path=/smoke.txt`
	);
	if (downloaded.toString('utf8') !== 'hello-from-sftp\n') {
		throw new Error(`SFTP download mismatch: ${downloaded.toString('utf8')}`);
	}

	await api.upload(
		`/api/sftp/${encodeURIComponent(hostId)}/upload?path=/uploaded.txt`,
		'uploaded.txt',
		Buffer.from('uploaded-through-api\n')
	);
	const uploaded = await api.download(
		`/api/sftp/${encodeURIComponent(hostId)}/download?path=/uploaded.txt`
	);
	if (uploaded.toString('utf8') !== 'uploaded-through-api\n') {
		throw new Error(`SFTP uploaded file mismatch: ${uploaded.toString('utf8')}`);
	}

	await api.post(`/api/sftp/${encodeURIComponent(hostId)}/mkdir`, {
		path: '/workspace'
	});
	await api.put(`/api/sftp/${encodeURIComponent(hostId)}/text`, {
		path: '/workspace/note.txt',
		text: 'edited-through-text-api\n'
	});
	const textFile = await api.get(
		`/api/sftp/${encodeURIComponent(hostId)}/text?path=/workspace/note.txt`
	);
	if (textFile.text !== 'edited-through-text-api\n') {
		throw new Error(`SFTP text read mismatch: ${textFile.text}`);
	}

	await api.post(`/api/sftp/${encodeURIComponent(hostId)}/rename`, {
		from: '/workspace/note.txt',
		to: '/workspace/renamed.txt'
	});
	await api.post(`/api/sftp/${encodeURIComponent(hostId)}/move`, {
		from: '/uploaded.txt',
		to: '/workspace/uploaded-moved.txt'
	});
	const workspaceList = await api.get(
		`/api/sftp/${encodeURIComponent(hostId)}/list?path=/workspace`
	);
	const workspaceNames = workspaceList.entries.map((entry) => entry.name);
	for (const expectedName of ['renamed.txt', 'uploaded-moved.txt']) {
		if (!workspaceNames.includes(expectedName)) {
			throw new Error(
				`SFTP workspace list did not include ${expectedName}; saw ${workspaceNames.join(', ') || '<empty>'}.`
			);
		}
	}

	await api.delete(`/api/sftp/${encodeURIComponent(hostId)}/delete?path=/workspace/renamed.txt`);
	await api.delete(
		`/api/sftp/${encodeURIComponent(hostId)}/delete?path=/workspace/uploaded-moved.txt`
	);
	await api.delete(`/api/sftp/${encodeURIComponent(hostId)}/delete?path=/workspace`);
	const finalList = await api.get(`/api/sftp/${encodeURIComponent(hostId)}/list?path=/`);
	const finalNames = finalList.entries.map((entry) => entry.name);
	if (finalNames.includes('workspace') || finalNames.includes('uploaded.txt')) {
		throw new Error(`SFTP delete workflow left stale entries: ${finalNames.join(', ')}`);
	}
}

async function smokeSftpWorkspaceUi(page, hostId, databaseUrl) {
	const launchPage = await page.context().newPage();

	try {
		await launchPage.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=sftp`);
		await exerciseBrowserFileManager(launchPage, {
			hostId,
			apiBase: 'sftp',
			label: 'SFTP',
			fixtureName: 'smoke.txt',
			workspaceName: 'browser-sftp'
		});
	} finally {
		await launchPage.close().catch(() => {});
	}

	if (!databaseUrl) return;

	await waitFor(
		async () => {
			const session = await latestConnectionSession(databaseUrl, hostId, 'ssh');
			return session?.status === 'ended' && session.ended_at;
		},
		async () => {
			const session = await latestConnectionSession(databaseUrl, hostId, 'ssh');
			return session
				? `SFTP workspace session was not ended: ${JSON.stringify(session)}`
				: 'SFTP workspace did not create a connection session row.';
		}
	);
}

async function smokeFtpApi(api, hostId, protocol) {
	const prefix = `/api/ftp/${encodeURIComponent(hostId)}`;
	const fixtureName = `${protocol}-smoke.txt`;
	const fixtureText = `hello-from-${protocol}\n`;
	const list = await api.get(`${prefix}/list?path=/`);
	const names = list.entries.map((entry) => entry.name);
	if (!names.includes(fixtureName)) {
		throw new Error(
			`${protocol.toUpperCase()} list did not include ${fixtureName}; saw ${names.join(', ') || '<empty>'}.`
		);
	}

	const downloaded = await api.download(`${prefix}/download?path=/${fixtureName}`);
	if (downloaded.toString('utf8') !== fixtureText) {
		throw new Error(`${protocol.toUpperCase()} download mismatch: ${downloaded.toString('utf8')}`);
	}

	await api.upload(
		`${prefix}/upload?path=/uploaded.txt`,
		'uploaded.txt',
		Buffer.from(`uploaded-through-${protocol}\n`)
	);
	const uploaded = await api.download(`${prefix}/download?path=/uploaded.txt`);
	if (uploaded.toString('utf8') !== `uploaded-through-${protocol}\n`) {
		throw new Error(
			`${protocol.toUpperCase()} uploaded file mismatch: ${uploaded.toString('utf8')}`
		);
	}

	await api.post(`${prefix}/mkdir`, { path: '/workspace' });
	await api.put(`${prefix}/text`, {
		path: '/workspace/note.txt',
		text: `edited-through-${protocol}-text-api\n`
	});
	const textFile = await api.get(`${prefix}/text?path=/workspace/note.txt`);
	if (textFile.text !== `edited-through-${protocol}-text-api\n`) {
		throw new Error(`${protocol.toUpperCase()} text read mismatch: ${textFile.text}`);
	}

	await api.post(`${prefix}/rename`, {
		from: '/workspace/note.txt',
		to: '/workspace/renamed.txt'
	});
	await api.post(`${prefix}/move`, {
		from: '/uploaded.txt',
		to: '/workspace/uploaded-moved.txt'
	});
	const workspaceList = await api.get(`${prefix}/list?path=/workspace`);
	const workspaceNames = workspaceList.entries.map((entry) => entry.name);
	for (const expectedName of ['renamed.txt', 'uploaded-moved.txt']) {
		if (!workspaceNames.includes(expectedName)) {
			throw new Error(
				`${protocol.toUpperCase()} workspace list did not include ${expectedName}; saw ${workspaceNames.join(', ') || '<empty>'}.`
			);
		}
	}

	await api.delete(`${prefix}/delete?path=/workspace/renamed.txt`);
	await api.delete(`${prefix}/delete?path=/workspace/uploaded-moved.txt`);
	await api.delete(`${prefix}/delete?path=/workspace`);
	const finalList = await api.get(`${prefix}/list?path=/`);
	const finalNames = finalList.entries.map((entry) => entry.name);
	if (finalNames.includes('workspace') || finalNames.includes('uploaded.txt')) {
		throw new Error(
			`${protocol.toUpperCase()} delete workflow left stale entries: ${finalNames.join(', ')}`
		);
	}
}

async function smokeFtpWorkspaceUi(page, hostId, protocol, databaseUrl) {
	const launchPage = await page.context().newPage();
	const fixtureName = `${protocol}-smoke.txt`;
	const label = protocol.toUpperCase();

	try {
		await launchPage.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=${protocol}`);
		await exerciseBrowserFileManager(launchPage, {
			hostId,
			apiBase: 'ftp',
			label,
			fixtureName,
			workspaceName: `browser-${protocol}`
		});
	} finally {
		await launchPage.close().catch(() => {});
	}

	if (!databaseUrl) return;

	await waitFor(
		async () => {
			const session = await latestConnectionSession(databaseUrl, hostId, protocol);
			return session?.status === 'ended' && session.ended_at;
		},
		async () => {
			const session = await latestConnectionSession(databaseUrl, hostId, protocol);
			return session
				? `${protocol.toUpperCase()} workspace session was not ended: ${JSON.stringify(session)}`
				: `${protocol.toUpperCase()} workspace did not create a connection session row.`;
		}
	);
}

async function exerciseBrowserFileManager(
	page,
	{ hostId, apiBase, label, fixtureName, workspaceName }
) {
	const manager = page.getByRole('region', { name: `${label} file manager` });
	const remotePath = manager.getByLabel('Remote path');
	const uploadName = `${workspaceName}-upload.txt`;
	const renamedName = `${workspaceName}-renamed.txt`;
	const workspacePath = `/${workspaceName}`;
	const renamedPath = `${workspacePath}/${renamedName}`;
	const uploadedText = `${label} browser upload through production endpoint\n`;
	const editedText = `${label} browser edit through production endpoint\n`;

	await manager.waitFor({ timeout: timeoutMs });
	await manager.getByRole('button', { name: fixtureName, exact: true }).waitFor({
		timeout: timeoutMs
	});
	await waitForInputValue(remotePath, '/', `${label} file manager did not open at root.`);

	await manager.getByLabel('New folder name').fill(workspaceName);
	await manager.getByRole('button', { name: 'Create folder' }).click();
	await manager.getByRole('button', { name: workspaceName, exact: true }).waitFor({
		timeout: timeoutMs
	});

	await manager.getByRole('button', { name: workspaceName, exact: true }).click();
	await waitForInputValue(
		remotePath,
		workspacePath,
		`${label} file manager did not navigate into ${workspacePath}.`
	);

	await manager.getByLabel('Upload files').setInputFiles({
		name: uploadName,
		mimeType: 'text/plain',
		buffer: Buffer.from(uploadedText)
	});
	await manager.getByRole('button', { name: uploadName, exact: true }).waitFor({
		timeout: timeoutMs
	});

	await manager.getByRole('button', { name: uploadName, exact: true }).click();
	const editor = manager.getByPlaceholder('Open a text file to edit it');
	await waitForInputValue(
		editor,
		uploadedText,
		`${label} text editor did not read the uploaded file through the app endpoint.`
	);
	await editor.fill(editedText);
	const saveResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'PUT' &&
			response.url().includes(`/api/${apiBase}/${encodeURIComponent(hostId)}/text`) &&
			response.status() >= 200 &&
			response.status() < 300,
		{ timeout: timeoutMs }
	);
	const listAfterSaveResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			response.url().includes(`/api/${apiBase}/${encodeURIComponent(hostId)}/list`) &&
			response.url().includes(`path=${encodeURIComponent(workspacePath)}`) &&
			response.status() >= 200 &&
			response.status() < 300,
		{ timeout: timeoutMs }
	);
	await manager.getByRole('button', { name: 'Save text file' }).click();
	await saveResponse;
	await listAfterSaveResponse;
	await waitForInputValue(
		editor,
		editedText,
		`${label} text editor did not retain the saved edit.`
	);

	await manager.getByRole('button', { name: uploadName, exact: true }).click();
	const renameInput = manager.getByLabel('Rename or move target path');
	await waitForLocatorEnabled(
		renameInput,
		`${label} rename input did not enable after selecting ${uploadName}.`
	);
	await renameInput.fill(renamedPath);
	const renameButton = manager.getByRole('button', { name: 'Rename or move selected path' });
	await waitForLocatorEnabled(
		renameButton,
		`${label} rename button did not enable after setting ${renamedPath}.`
	);
	await renameButton.click();
	await manager.getByRole('button', { name: renamedName, exact: true }).waitFor({
		timeout: timeoutMs
	});

	await manager.getByRole('button', { name: 'Parent directory' }).click();
	await waitForInputValue(remotePath, '/', `${label} file manager did not navigate back to root.`);
	await manager.getByLabel('Remote search').fill(renamedName);
	await manager.getByRole('button', { name: 'Tree search' }).click();
	await manager.getByText('Search results (1)', { exact: true }).waitFor({ timeout: timeoutMs });
	await manager.getByRole('button', { name: renamedPath, exact: true }).click();
	await waitForInputValue(
		remotePath,
		workspacePath,
		`${label} search result did not navigate to ${workspacePath}.`
	);

	const downloadResponse = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			response.url().includes(`/api/${apiBase}/${encodeURIComponent(hostId)}/download`) &&
			response.url().includes(`path=${encodeURIComponent(renamedPath)}`) &&
			response.status() >= 200 &&
			response.status() < 300,
		{ timeout: timeoutMs }
	);
	const downloadButton = manager.getByRole('button', { name: 'Download selected paths' });
	await waitForLocatorEnabled(
		downloadButton,
		`${label} download button did not enable after selecting ${renamedName}.`
	);
	await downloadButton.click();
	const downloaded = await downloadResponse;
	const downloadedText = await downloaded.text();
	assert.equal(
		downloadedText,
		editedText,
		`${label} browser download returned the wrong file contents.`
	);

	const deleteButton = manager.getByRole('button', { name: 'Delete selected paths' });
	await waitForLocatorEnabled(
		deleteButton,
		`${label} delete button did not enable after selecting ${renamedName}.`
	);
	await deleteButton.click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete selected' }).click();
	await waitForLocatorCount(
		manager.getByRole('button', { name: renamedName, exact: true }),
		0,
		`${label} file manager did not remove ${renamedName}.`
	);

	await manager.getByRole('button', { name: 'Parent directory' }).click();
	await waitForInputValue(remotePath, '/', `${label} file manager did not return to root.`);
	await manager.getByLabel('Remote search').fill('');
	await manager.getByLabel(`Select ${workspaceName}`).click();
	await waitForLocatorEnabled(
		deleteButton,
		`${label} delete button did not enable after selecting ${workspaceName}.`
	);
	await deleteButton.click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete selected' }).click();
	await waitForLocatorCount(
		manager.getByRole('button', { name: workspaceName, exact: true }),
		0,
		`${label} file manager did not remove ${workspaceName}.`
	);
}

async function waitForInputValue(locator, expected, message) {
	await waitFor(async () => {
		const value = await locator.inputValue().catch(() => null);
		return value === expected;
	}, message);
}

async function waitForLocatorCount(locator, expected, message) {
	await waitFor(async () => (await locator.count()) === expected, message);
}

async function waitForLocatorEnabled(locator, message) {
	await waitFor(async () => locator.isEnabled().catch(() => false), message);
}

async function latestConnectionSession(databaseUrl, hostId, protocol) {
	const sql = postgres(databaseUrl, { max: 1 });
	try {
		const [session] = await sql`
			select id, status, ended_at
			from connection_sessions
			where host_id = ${hostId} and protocol = ${protocol}
			order by started_at desc
			limit 1
		`;
		return session ?? null;
	} finally {
		await sql.end({ timeout: 1 });
	}
}

async function smokeTelnetWebSocket(api, baseUrl, cookieHeader, hostId, telnetState) {
	const ticket = await createTicket(api, hostId, 'telnet');
	const socket = await openWebSocket(
		baseUrl,
		`/ws/telnet/${encodeURIComponent(ticket)}`,
		cookieHeader
	);
	let output = '';
	let sentProbe = false;

	try {
		socket.send(JSON.stringify({ type: 'terminal.resize', cols: 132, rows: 43 }));
		await waitForSocketCondition(socket, 'Telnet output', (data) => {
			output += data.toString('utf8');
			if (!sentProbe && output.includes('telnet-ready')) {
				sentProbe = true;
				socket.send(Buffer.from('probe\n'));
			}
			return output.includes('echo:probe');
		});
		await waitFor(() => telnetState.sawProbe, 'Telnet fixture did not receive probe input.');
		await waitFor(
			() => bufferIncludes(telnetState.received, Buffer.from([IAC, WILL, NAWS])),
			'Telnet bridge did not accept NAWS negotiation.'
		);
		await waitFor(
			() =>
				bufferIncludes(telnetState.received, Buffer.from([IAC, SB, NAWS, 0, 132, 0, 43, IAC, SE])),
			'Telnet bridge did not send expected 132x43 NAWS dimensions.'
		);
	} finally {
		socket.close();
	}
}

async function smokeTelnetBrowserUi(page, hostId, telnetState) {
	const launchPage = await page.context().newPage();
	const initialConnectionCount = telnetState.connectionCount;
	const initialNawsCount = telnetState.nawsFrames.length;

	try {
		await launchPage.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=telnet`);
		await waitFor(
			() => telnetState.connectionCount > initialConnectionCount,
			'Telnet browser launch did not reach the local fixture.'
		);
		await waitFor(
			() => telnetState.nawsFrames.length > initialNawsCount,
			'Telnet browser launch did not send terminal dimensions through NAWS.'
		);

		await launchPage.getByRole('button', { name: 'whoami', exact: true }).click();
		await waitFor(
			() => telnetState.sawBrowserProbe,
			'Telnet fixture did not receive browser terminal input.'
		);

		const beforeCloseCount = telnetState.closedCount;
		await launchPage.getByRole('button', { name: 'Close session', exact: true }).click();
		await waitFor(
			() => telnetState.closedCount > beforeCloseCount,
			'Telnet browser close did not close the fixture socket.'
		);
		await waitFor(
			async () => {
				const bodyText = (await launchPage.locator('body').textContent()) ?? '';
				return (
					bodyText.includes('Telnet disconnected') &&
					bodyText.includes('Reconnect to create a new session.')
				);
			},
			async () => {
				const bodyText = ((await launchPage.locator('body').textContent()) ?? '')
					.replace(/\s+/g, ' ')
					.trim();
				return `Telnet UI did not show disconnected state: ${bodyText}`;
			}
		);

		const beforeReconnectCount = telnetState.connectionCount;
		await launchPage.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await waitFor(
			() => telnetState.connectionCount > beforeReconnectCount,
			'Telnet browser reconnect did not open a fresh fixture connection.'
		);
	} finally {
		await launchPage.close().catch(() => {});
	}
}

async function smokeVncWebSocket(api, baseUrl, cookieHeader, hostId, vncState) {
	const ticket = await createTicket(api, hostId, 'vnc');
	const initialClientVersionCount = vncState.clientVersionCount;
	const socket = await openWebSocket(
		baseUrl,
		`/ws/vnc/${encodeURIComponent(ticket)}`,
		cookieHeader
	);

	try {
		await waitForSocketCondition(socket, 'VNC RFB banner', (data) => {
			if (!Buffer.from(data).subarray(0, rfbVersion.length).equals(rfbVersion)) return false;
			socket.send(rfbVersion);
			return true;
		});
		await waitFor(
			() => vncState.clientVersionCount > initialClientVersionCount,
			'VNC fixture did not receive client RFB version.'
		);
	} finally {
		socket.close();
	}
}

async function startMockRdpGateway() {
	const provisionerSubject = process.env.GATEWAY_PROVISIONER_SUBJECT ?? 'TermixKit';
	const provisionerKey = process.env.GATEWAY_PROVISIONER_KEY ?? 'app-smoke-local-key';
	const appToken = 'app-smoke-gateway-app-token';
	const associationToken = 'app-smoke-gateway-association-token';
	const requests = [];
	const server = createHttpServer(async (request, response) => {
		try {
			const body = await readJsonBody(request);
			const gatewayRequestUrl = new URL(request.url, 'http://127.0.0.1');
			const path = gatewayRequestUrl.pathname;
			requests.push({
				method: request.method,
				path,
				query: gatewayRequestUrl.search,
				authorization: request.headers.authorization,
				headers: request.headers,
				body
			});

			if (request.method !== 'POST') {
				if (request.method === 'GET' && path === '/jet/rdp') {
					writeJson(response, 200, { ok: true });
					return;
				}
				writeText(response, 405, 'Method Not Allowed', 'method not allowed');
				return;
			}

			if (path === '/jet/webapp/app-token') {
				assert(
					request.headers.authorization ===
						`Basic ${Buffer.from(`${provisionerSubject}:${provisionerKey}`).toString('base64')}`,
					'RDP app-token request used the wrong Authorization header'
				);
				assert(body.content_type === 'WEBAPP', 'RDP app-token request used the wrong content type');
				assert(typeof body.subject === 'string' && body.subject, 'RDP app-token subject missing');
				writeText(response, 200, 'OK', appToken);
				return;
			}

			if (path === '/jet/webapp/session-token') {
				assert(
					request.headers.authorization === `Bearer ${appToken}`,
					'RDP session-token request used the wrong Authorization header'
				);
				assert(
					body.content_type === 'ASSOCIATION',
					'RDP session-token request used the wrong content type'
				);
				assert(body.protocol === 'rdp', 'RDP session-token request used the wrong protocol');
				assert(typeof body.session_id === 'string' && body.session_id, 'RDP session id missing');
				writeText(response, 200, 'OK', associationToken);
				return;
			}

			writeText(response, 404, 'Not Found', 'not found');
		} catch (error) {
			writeText(response, 500, 'Internal Server Error', errorText(error));
		}
	});

	await listen(server);
	const address = server.address();
	assert(address && typeof address !== 'string', 'mock RDP Gateway did not bind a TCP port');

	return {
		url: `http://127.0.0.1:${address.port}`,
		requests,
		close: () => closeServer(server)
	};
}

function openWebSocket(baseUrl, path, cookieHeader) {
	const url = new URL(path, baseUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

	return new Promise((resolveSocket, reject) => {
		const socket = new WebSocket(url, {
			headers: {
				cookie: cookieHeader,
				origin: new URL(baseUrl).origin
			}
		});
		const timer = setTimeout(() => {
			socket.terminate();
			reject(new Error(`Timed out opening websocket ${path}.`));
		}, timeoutMs);
		socket.once('open', () => {
			clearTimeout(timer);
			resolveSocket(socket);
		});
		socket.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

function waitForSocketCondition(socket, label, onMessage) {
	return new Promise((resolveWait, reject) => {
		let settled = false;
		const timer = setTimeout(() => settle(reject, new Error(`${label} timed out.`)), timeoutMs);

		const settle = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.off('message', onSocketMessage);
			socket.off('close', onClose);
			socket.off('error', onError);
			callback(value);
		};
		const onSocketMessage = (data) => {
			try {
				if (onMessage(Buffer.from(data))) settle(resolveWait);
			} catch (error) {
				settle(reject, error);
			}
		};
		const onClose = (code, reason) =>
			settle(reject, new Error(`${label} websocket closed early: ${code} ${reason}`));
		const onError = (error) => settle(reject, error);

		socket.on('message', onSocketMessage);
		socket.once('close', onClose);
		socket.once('error', onError);
	});
}

async function startProtocolFixtures() {
	const sshServer = createSshFixtureServer();
	const ftp = createFtpFixtureServer({
		label: 'ftp',
		files: new Map([['/ftp-smoke.txt', Buffer.from('hello-from-ftp\n')]])
	});
	const ftpsIdentity = await createTemporaryTlsIdentity();
	const ftps = createFtpFixtureServer({
		label: 'ftps',
		files: new Map([['/ftps-smoke.txt', Buffer.from('hello-from-ftps\n')]]),
		tls: ftpsIdentity
	});
	const telnet = createTelnetFixtureServer();
	const vnc = createVncFixtureServer();

	await Promise.all([
		listen(sshServer),
		listen(ftp.server),
		listen(ftps.server),
		listen(telnet.server),
		listen(vnc.server)
	]);

	return {
		sshPort: sshServer.address().port,
		ftpPort: ftp.server.address().port,
		ftpsPort: ftps.server.address().port,
		ftpsState: ftps.state,
		telnetPort: telnet.server.address().port,
		vncPort: vnc.server.address().port,
		telnetState: telnet.state,
		vncState: vnc.state,
		closeVncClients: () => vnc.server.closeAllClients?.(),
		summary: `ssh:${sshServer.address().port} ftp:${ftp.server.address().port} ftps:${ftps.server.address().port} telnet:${telnet.server.address().port} vnc:${vnc.server.address().port}`,
		close: async () => {
			await Promise.all([
				closeServer(sshServer),
				closeServer(ftp.server),
				closeServer(ftps.server),
				closeServer(telnet.server),
				closeServer(vnc.server)
			]);
		}
	};
}

function createSshFixtureServer() {
	const files = new Map([['/smoke.txt', Buffer.from('hello-from-sftp\n')]]);
	const directories = new Set(['/']);
	const clients = new Set();
	const hostKeys = [utils.generateKeyPairSync('ed25519').private];
	const server = new SshServer({ hostKeys }, (client) => {
		clients.add(client);
		client.once('close', () => clients.delete(client));
		client
			.on('error', () => clients.delete(client))
			.on('authentication', (context) => {
				if (
					context.method === 'password' &&
					context.username === 'smoke' &&
					context.password === 'smoke-password'
				) {
					context.accept();
					return;
				}
				context.reject();
			})
			.on('ready', () => {
				client.on('session', (accept) => {
					const session = accept();
					session.on('pty', (acceptPty) => acceptPty?.());
					session.on('shell', (acceptShell) => {
						const stream = acceptShell();
						stream.write('ssh-ready\n');
						stream.on('data', (chunk) => {
							if (chunk.includes(Buffer.from('smoke-shell'))) {
								stream.write('ssh-echo:smoke-shell\n');
								stream.exit(0);
								stream.end();
							}
						});
					});
					session.on('sftp', (acceptSftp) =>
						installSftpFixtureServer(acceptSftp(), { files, directories })
					);
				});
			});
	});

	server.closeAllClients = () => {
		for (const client of clients) client.end();
		clients.clear();
	};
	return server;
}

async function createTemporaryTlsIdentity() {
	const keyPath = join(tempDir, 'ftps-key.pem');
	const certPath = join(tempDir, 'ftps-cert.pem');
	await execFile('openssl', [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-keyout',
		keyPath,
		'-out',
		certPath,
		'-nodes',
		'-days',
		'1',
		'-subj',
		'/CN=127.0.0.1',
		'-addext',
		'subjectAltName=IP:127.0.0.1'
	]);
	const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
	return { key, cert };
}
