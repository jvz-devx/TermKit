import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'docs/assets/readme');
const adminUsername = process.env.README_SCREENSHOT_USERNAME ?? 'readme-admin';
const adminPassword = process.env.README_SCREENSHOT_PASSWORD ?? 'Readme-Admin-Password-42!';
const viewport = { width: 1440, height: 1050 };

let appProcess;

try {
	await mkdir(outputDir, { recursive: true });
	const baseUrl = process.env.README_SCREENSHOT_BASE_URL ?? (await startLocalApp());
	await captureScreenshots(baseUrl);
} finally {
	if (appProcess && !appProcess.killed) {
		appProcess.kill('SIGTERM');
	}
}

async function startLocalApp() {
	const port = process.env.README_SCREENSHOT_PORT ?? String(await findFreePort());
	const baseUrl = `http://127.0.0.1:${port}`;

	await runChecked('npm', ['run', 'build']);

	appProcess = spawn(process.execPath, ['scripts/playwright-start-app.mjs'], {
		cwd: root,
		env: {
			...process.env,
			PLAYWRIGHT_PORT: port,
			PORT: port
		},
		stdio: 'inherit'
	});

	await waitForApp(baseUrl);
	return baseUrl;
}

async function captureScreenshots(baseUrl) {
	const browser = await chromium.launch({
		executablePath: await chromiumExecutablePath(),
		args: ['--no-first-run', '--disable-default-apps']
	});

	try {
		const context = await browser.newContext({
			baseURL: baseUrl,
			viewport,
			colorScheme: 'dark',
			deviceScaleFactor: 1
		});
		const page = await context.newPage();

		await ensureAdminSession(page);
		await page.evaluate(() => localStorage.setItem('termkit:theme-mode', 'dark'));
		const created = await seedDemoData(page);

		await screenshotPage(page, '/hosts', 'heading', 'Hosts');
		await page.getByPlaceholder('Search name, address, folder, or tag').fill('Demo');
		await page.screenshot({ path: join(outputDir, 'hosts.png') });

		await screenshotPage(
			page,
			`/sessions?host=${encodeURIComponent(created.ssh.id)}&tab=ssh`,
			'heading',
			'Sessions'
		);
		await openVisibleSshTerminal(page);
		await page.screenshot({ path: join(outputDir, 'sessions.png') });

		await screenshotPage(page, '/admin', 'heading', 'Admin');
		await page.getByRole('tab', { name: 'Settings' }).click();
		await page.screenshot({ path: join(outputDir, 'admin.png') });

		await context.close();
	} finally {
		await browser.close();
	}
}

async function ensureAdminSession(page) {
	await page.goto('/hosts');

	if (/\/first-run$/.test(page.url())) {
		await page.getByLabel('Username').fill(adminUsername);
		await page.getByLabel('Password', { exact: true }).fill(adminPassword);
		await page.getByLabel('Confirm password').fill(adminPassword);
		await page.getByRole('button', { name: 'Create admin' }).click();
		await page.waitForURL(/\/hosts$/);
		return;
	}

	if (/\/login$/.test(page.url())) {
		await page.getByLabel('Username', { exact: true }).fill(adminUsername);
		await page.getByLabel('Password', { exact: true }).fill(adminPassword);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL(/\/hosts$/);
	}
}

async function seedDemoData(page) {
	const credential = await createCredential(page, {
		name: 'Demo operator credential',
		kind: 'password',
		username: 'operator',
		secret: 'not-a-real-secret'
	});
	const hosts = [
		{
			name: 'Demo SSH bastion',
			protocol: 'ssh',
			hostname: 'ssh.demo.internal',
			port: 22,
			username: 'operator',
			credentialId: credential.id,
			folder: 'Production',
			tags: ['linux', 'critical', 'region:ams']
		},
		{
			name: 'Demo RDP workstation',
			protocol: 'rdp',
			hostname: 'rdp.demo.internal',
			port: 3389,
			username: 'administrator',
			credentialId: credential.id,
			folder: 'Windows',
			tags: ['desktop', 'region:fra']
		},
		{
			name: 'Demo VNC console',
			protocol: 'vnc',
			hostname: 'vnc.demo.internal',
			port: 5900,
			username: 'viewer',
			credentialId: credential.id,
			folder: 'Remote desktop',
			tags: ['console', 'region:ams']
		},
		{
			name: 'Demo FTP dropbox',
			protocol: 'ftp',
			hostname: 'ftp.demo.internal',
			port: 21,
			username: 'file-operator',
			credentialId: credential.id,
			folder: 'File transfer',
			tags: ['files', 'staging']
		},
		{
			name: 'Demo Telnet lab',
			protocol: 'telnet',
			hostname: 'telnet.demo.internal',
			port: 23,
			username: 'console',
			credentialId: null,
			folder: 'Lab',
			tags: ['legacy', 'lab']
		}
	];

	const created = {};
	for (const host of hosts) {
		created[host.protocol] = await createHost(page, host);
	}

	return created;
}

async function createCredential(page, input) {
	const existing = await listCredentials(page);
	const match = existing.find((credential) => credential.name === input.name);
	if (match) return match;

	const response = await page.request.post('/api/credentials', { data: input });
	if (response.status() !== 201) {
		throw new Error(`Failed to create credential: ${response.status()} ${await response.text()}`);
	}
	const body = await response.json();
	return body.credential;
}

async function createHost(page, input) {
	const existing = await listHosts(page);
	const match = existing.find((host) => host.name === input.name);
	if (match) return match;

	const response = await page.request.post('/api/hosts', { data: input });
	if (response.status() !== 201) {
		throw new Error(
			`Failed to create host ${input.name}: ${response.status()} ${await response.text()}`
		);
	}
	const body = await response.json();
	return body.host;
}

async function listCredentials(page) {
	const response = await page.request.get('/api/credentials');
	if (response.status() !== 200)
		throw new Error(`Failed to list credentials: ${response.status()}`);
	const body = await response.json();
	return body.credentials;
}

async function listHosts(page) {
	const response = await page.request.get('/api/hosts');
	if (response.status() !== 200) throw new Error(`Failed to list hosts: ${response.status()}`);
	const body = await response.json();
	return body.hosts;
}

async function screenshotPage(page, url, role, name) {
	await page.goto(url);
	await page.getByRole(role, { name }).waitFor({ state: 'visible' });
	await page.waitForLoadState('networkidle').catch(() => {});
}

async function openVisibleSshTerminal(page) {
	const attachButton = page.getByRole('button', { name: 'Attach tab' });
	if (await attachButton.isVisible().catch(() => false)) {
		await attachButton.click();
	} else {
		const newTabButton = page.getByRole('button', { name: 'New SSH tab' });
		if (await newTabButton.isVisible().catch(() => false)) {
			await newTabButton.click();
		}
	}

	await page
		.getByText('Attaching live SSH session...', { exact: true })
		.first()
		.waitFor({ state: 'visible', timeout: 12_000 })
		.catch(() => {});
}

async function waitForApp(baseUrl) {
	let lastError;
	for (let attempt = 0; attempt < 240; attempt += 1) {
		try {
			const response = await fetch(baseUrl, { redirect: 'manual' });
			if (response.status > 0) return;
		} catch (error) {
			lastError = error;
		}
		await delay(500);
	}
	throw new Error(
		`Timed out waiting for ${baseUrl}: ${lastError instanceof Error ? lastError.message : 'unknown error'}`
	);
}

async function runChecked(command, args) {
	await new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit' });

		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
		});
	});
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

async function findFreePort() {
	return await new Promise((resolvePromise, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => {
				if (address && typeof address === 'object') {
					resolvePromise(address.port);
					return;
				}
				reject(new Error('Could not allocate a free local port.'));
			});
		});
		server.on('error', reject);
	});
}

function delay(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
