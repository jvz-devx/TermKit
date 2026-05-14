import { spawn, execFile as execFileCallback } from 'node:child_process';
import { once } from 'node:events';
import { constants as fsConstants, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import posixPath from 'node:path/posix';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const { Server: SshServer, utils } = require('ssh2');
const execFile = promisify(execFileCallback);

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

const { STATUS_CODE } = utils.sftp;
const IAC = 255;
const DO = 253;
const WILL = 251;
const SB = 250;
const SE = 240;
const NAWS = 31;
const rfbVersion = Buffer.from('RFB 003.008\n');

const cleanup = [];
const results = [];
let appProcess;
let appLogs;
let postgresContainerName;
let tempDir;

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
	pass('SFTP API list/download/upload', 'verified smoke.txt and uploaded.txt');

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
	await smokeVncSavedCredentialLaunchUi(auth.page, vncHost.id, fixtures.vncState);
	pass(
		'VNC saved credential staging',
		'staged saved password, noVNC sent an auth response, and the secret was not rendered'
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
		await smokeRdpSessionLaunchUi(auth.page, rdpHost.id, gateway);
		pass('RDP remote launch boundary', 'staged saved password through Gateway bootstrap');
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

async function createHost(api, input) {
	const { host } = await api.post('/api/hosts', input);
	return host;
}

async function smokeVncSavedCredentialLaunchUi(page, hostId, vncState) {
	const launchPage = await page.context().newPage();
	const initialAuthResponseCount = vncState.authResponseCount;

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
	} finally {
		await launchPage.close().catch(() => {});
	}
}

async function smokeRdpSessionLaunchUi(page, hostId, gateway) {
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

		const requests = gateway.requests.slice(initialGatewayRequests);
		assert(requests[0]?.path === '/jet/webapp/app-token', 'missing RDP app-token request');
		assert(requests[1]?.path === '/jet/webapp/session-token', 'missing RDP session-token request');
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
	await page.getByRole('button', { name: 'SSH tab' }).click();
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
			const path = new URL(request.url, 'http://127.0.0.1').pathname;
			requests.push({
				method: request.method,
				path,
				authorization: request.headers.authorization,
				body
			});

			if (request.method !== 'POST') {
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
	const telnet = createTelnetFixtureServer();
	const vnc = createVncFixtureServer();

	await Promise.all([listen(sshServer), listen(telnet.server), listen(vnc.server)]);

	return {
		sshPort: sshServer.address().port,
		telnetPort: telnet.server.address().port,
		vncPort: vnc.server.address().port,
		telnetState: telnet.state,
		vncState: vnc.state,
		summary: `ssh:${sshServer.address().port} telnet:${telnet.server.address().port} vnc:${vnc.server.address().port}`,
		close: async () => {
			await Promise.all([
				closeServer(sshServer),
				closeServer(telnet.server),
				closeServer(vnc.server)
			]);
		}
	};
}

function createSshFixtureServer() {
	const files = new Map([['/smoke.txt', Buffer.from('hello-from-sftp\n')]]);
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
					session.on('sftp', (acceptSftp) => installSftpFixtureServer(acceptSftp(), files));
				});
			});
	});

	server.closeAllClients = () => {
		for (const client of clients) client.end();
		clients.clear();
	};
	return server;
}

function installSftpFixtureServer(sftp, files) {
	const handles = new Map();
	let nextHandle = 1;

	sftp
		.on('REALPATH', (requestId, path = '/') => {
			const resolved = normalizeRemotePath(path);
			sftp.name(requestId, [
				{
					filename: resolved,
					longname: longname(resolved, directoryAttrs()),
					attrs: resolved === '/' ? directoryAttrs() : fileAttrs(files.get(resolved)?.length ?? 0)
				}
			]);
		})
		.on('STAT', (requestId, path) => sendAttrs(sftp, requestId, files, path))
		.on('LSTAT', (requestId, path) => sendAttrs(sftp, requestId, files, path))
		.on('FSTAT', (requestId, handle) => {
			const entry = getHandle(handles, handle);
			if (!entry) {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}
			sftp.attrs(requestId, entry.type === 'dir' ? directoryAttrs() : fileAttrs(entry.size()));
		})
		.on('OPENDIR', (requestId, path) => {
			if (normalizeRemotePath(path) !== '/') {
				sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
				return;
			}
			const handle = createHandle(nextHandle++);
			handles.set(handle.readUInt32BE(0), { type: 'dir', sent: false });
			sftp.handle(requestId, handle);
		})
		.on('READDIR', (requestId, handle) => {
			const entry = getHandle(handles, handle);
			if (!entry || entry.type !== 'dir') {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}
			if (entry.sent) {
				sftp.status(requestId, STATUS_CODE.EOF);
				return;
			}
			entry.sent = true;
			sftp.name(
				requestId,
				[...files.entries()].map(([path, data]) => {
					const attrs = fileAttrs(data.length);
					return {
						filename: posixPath.basename(path),
						longname: longname(posixPath.basename(path), attrs),
						attrs
					};
				})
			);
		})
		.on('OPEN', (requestId, path, flags) => {
			const remotePath = normalizeRemotePath(path);
			if (remotePath === '/') {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}
			if (!files.has(remotePath) && !isWritableOpen(flags)) {
				sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
				return;
			}
			if (isWritableOpen(flags)) files.set(remotePath, Buffer.alloc(0));

			const handle = createHandle(nextHandle++);
			handles.set(handle.readUInt32BE(0), {
				type: 'file',
				path: remotePath,
				size: () => files.get(remotePath)?.length ?? 0
			});
			sftp.handle(requestId, handle);
		})
		.on('READ', (requestId, handle, offset, length) => {
			const entry = getHandle(handles, handle);
			if (!entry || entry.type !== 'file') {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}
			const data = files.get(entry.path) ?? Buffer.alloc(0);
			if (offset >= data.length) {
				sftp.status(requestId, STATUS_CODE.EOF);
				return;
			}
			sftp.data(requestId, data.subarray(offset, Math.min(offset + length, data.length)));
		})
		.on('WRITE', (requestId, handle, offset, data) => {
			const entry = getHandle(handles, handle);
			if (!entry || entry.type !== 'file') {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}
			const current = files.get(entry.path) ?? Buffer.alloc(0);
			const next = Buffer.alloc(Math.max(current.length, offset + data.length));
			current.copy(next);
			data.copy(next, offset);
			files.set(entry.path, next);
			sftp.status(requestId, STATUS_CODE.OK);
		})
		.on('CLOSE', (requestId, handle) => {
			const id = handle.length === 4 ? handle.readUInt32BE(0) : null;
			if (id === null || !handles.delete(id)) {
				sftp.status(requestId, STATUS_CODE.FAILURE);
				return;
			}
			sftp.status(requestId, STATUS_CODE.OK);
		});
}

function sendAttrs(sftp, requestId, files, path) {
	const remotePath = normalizeRemotePath(path);
	if (remotePath === '/') {
		sftp.attrs(requestId, directoryAttrs());
		return;
	}
	const data = files.get(remotePath);
	if (!data) {
		sftp.status(requestId, STATUS_CODE.NO_SUCH_FILE);
		return;
	}
	sftp.attrs(requestId, fileAttrs(data.length));
}

function createTelnetFixtureServer() {
	const sockets = new Set();
	const state = {
		received: Buffer.alloc(0),
		sawProbe: false
	};
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
		socket.write(Buffer.concat([Buffer.from([IAC, DO, NAWS]), Buffer.from('telnet-ready\r\n')]));
		socket.on('data', (chunk) => {
			state.received = Buffer.concat([state.received, chunk]);
			if (!state.sawProbe && chunk.includes(Buffer.from('probe\n'))) {
				state.sawProbe = true;
				socket.end('echo:probe\r\n');
			}
		});
	});
	server.closeAllClients = () => {
		for (const socket of sockets) socket.destroy();
		sockets.clear();
	};
	return { server, state };
}

function createVncFixtureServer() {
	const sockets = new Set();
	const state = {
		events: [],
		lastStage: 'idle',
		selectedSecurityType: null,
		authResponseBytes: 0,
		clientVersionCount: 0,
		authResponseCount: 0,
		sawClientVersion: false,
		sawAuthResponse: false
	};
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
		socket.write(rfbVersion);
		recordVncEvent(state, 'server-version-sent');
		let buffer = Buffer.alloc(0);
		let stage = 'version';

		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			state.lastStage = stage;
			recordVncEvent(state, `${stage}:${chunk.length}b`);

			if (stage === 'version' && buffer.length >= rfbVersion.length) {
				state.sawClientVersion = buffer.subarray(0, rfbVersion.length).equals(rfbVersion);
				if (state.sawClientVersion) state.clientVersionCount += 1;
				buffer = buffer.subarray(rfbVersion.length);
				stage = 'security-type';
				state.lastStage = stage;
				socket.write(Buffer.from([1, 2])); // one supported security type: VNC auth
				recordVncEvent(state, 'security-types-sent:vnc-auth');
			}

			if (stage === 'security-type' && buffer.length >= 1) {
				state.selectedSecurityType = buffer[0];
				if (buffer[0] !== 2) {
					recordVncEvent(state, `unsupported-security-type:${buffer[0]}`);
					socket.end();
					return;
				}
				buffer = buffer.subarray(1);
				stage = 'auth-response';
				state.lastStage = stage;
				socket.write(Buffer.from('termixkit-vnc-00'));
				recordVncEvent(state, 'challenge-sent');
			}

			if (stage === 'auth-response' && buffer.length >= 16) {
				state.authResponseBytes = buffer.length;
				state.sawAuthResponse = true;
				state.authResponseCount += 1;
				buffer = buffer.subarray(16);
				stage = 'server-init';
				state.lastStage = stage;
				socket.write(Buffer.concat([Buffer.alloc(4), rfbServerInit('TermixKit smoke VNC')]));
				recordVncEvent(state, 'auth-response-received');
			}
		});
	});
	server.closeAllClients = () => {
		for (const socket of sockets) socket.destroy();
		sockets.clear();
	};
	return { server, state };
}

function recordVncEvent(state, event) {
	state.events.push(event);
	if (state.events.length > 12) state.events.shift();
}

function describeVncState(state) {
	return `stage=${state.lastStage} selectedSecurityType=${state.selectedSecurityType ?? '<none>'} authResponseBytes=${state.authResponseBytes} events=${state.events.join(' > ') || '<none>'}`;
}

function rfbServerInit(name) {
	const nameBuffer = Buffer.from(name);
	const pixelFormat = Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
	const header = Buffer.alloc(8);
	header.writeUInt16BE(1, 0);
	header.writeUInt16BE(1, 2);
	header.writeUInt32BE(nameBuffer.length, 4);
	return Buffer.concat([header.subarray(0, 4), pixelFormat, header.subarray(4), nameBuffer]);
}

function normalizeRemotePath(path) {
	const value = typeof path === 'string' && path.trim() ? path.trim() : '/';
	const normalized = posixPath.normalize(value.startsWith('/') ? value : `/${value}`);
	return normalized === '.' ? '/' : normalized;
}

function createHandle(id) {
	const handle = Buffer.alloc(4);
	handle.writeUInt32BE(id, 0);
	return handle;
}

function getHandle(handles, handle) {
	if (handle.length !== 4) return null;
	return handles.get(handle.readUInt32BE(0)) ?? null;
}

function isWritableOpen(flags) {
	return (flags & 0x00000002) !== 0 || (flags & 0x00000008) !== 0 || (flags & 0x00000010) !== 0;
}

function directoryAttrs() {
	return {
		mode: fsConstants.S_IFDIR | 0o755,
		uid: 0,
		gid: 0,
		size: 0,
		atime: 0,
		mtime: 0
	};
}

function fileAttrs(size) {
	return {
		mode: fsConstants.S_IFREG | 0o644,
		uid: 0,
		gid: 0,
		size,
		atime: 0,
		mtime: 0
	};
}

function longname(name, attrs) {
	const kind = (attrs.mode & fsConstants.S_IFDIR) === fsConstants.S_IFDIR ? 'd' : '-';
	return `${kind}rw-r--r-- 1 smoke smoke ${attrs.size} Jan 1 1970 ${name}`;
}

function readJsonBody(request) {
	return new Promise((resolveBody, reject) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('error', reject);
		request.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			if (!raw) {
				resolveBody({});
				return;
			}

			try {
				resolveBody(JSON.parse(raw));
			} catch (error) {
				reject(error);
			}
		});
	});
}

function writeText(response, statusCode, statusMessage, text) {
	response.writeHead(statusCode, statusMessage, { 'content-type': 'text/plain; charset=utf-8' });
	response.end(text);
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

function listen(server) {
	server.listen(0, '127.0.0.1');
	return once(server, 'listening');
}

function closeServer(server) {
	return new Promise((resolveClose) => {
		server.closeAllClients?.();
		server.closeAllConnections?.();
		if (!server.listening) {
			resolveClose();
			return;
		}
		server.close(() => resolveClose());
	});
}

async function runChecked(command, args, env) {
	await new Promise((resolveRun, reject) => {
		const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) resolveRun();
			else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
		});
	});
}

function findAvailablePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Could not allocate TCP port.')));
				return;
			}
			server.close((error) => (error ? reject(error) : resolvePort(address.port)));
		});
	});
}

function waitForHttp(baseUrl, child, logs) {
	return new Promise((resolveReady, reject) => {
		const deadline = Date.now() + timeoutMs;
		const failIfExited = (code, signal) => {
			reject(
				new Error(`TermixKit exited before becoming ready: ${code ?? signal}\n${formatLogs(logs)}`)
			);
		};
		child.once('exit', failIfExited);

		const poll = async () => {
			try {
				const response = await fetch(baseUrl, { redirect: 'manual' });
				child.off('exit', failIfExited);
				response.body?.cancel();
				resolveReady();
				return;
			} catch {
				if (Date.now() >= deadline) {
					child.off('exit', failIfExited);
					reject(new Error(`Timed out waiting for TermixKit.\n${formatLogs(logs)}`));
					return;
				}
				setTimeout(poll, 100);
			}
		};
		void poll();
	});
}

function stopChild(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolveStop) => {
		const killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
		child.once('exit', () => {
			clearTimeout(killTimer);
			resolveStop();
		});
		child.kill('SIGTERM');
	});
}

async function waitFor(predicate, message) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await delay(50);
	}
	throw new Error(typeof message === 'function' ? await message() : message);
}

async function runCleanup(callbacks) {
	for (const callback of callbacks.toReversed()) {
		try {
			await Promise.race([callback(), delay(5_000)]);
		} catch {
			// Best-effort cleanup after smoke failures.
		}
	}
}

function bufferIncludes(buffer, needle) {
	return buffer.indexOf(needle) !== -1;
}

function formatLogs(logs) {
	return [
		`stdout:\n${logs.stdout.trim() || '<empty>'}`,
		`stderr:\n${logs.stderr.trim() || '<empty>'}`
	].join('\n');
}

function delay(ms) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
