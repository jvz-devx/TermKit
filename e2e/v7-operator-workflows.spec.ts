import {
	expect,
	test,
	type APIResponse,
	type BrowserContext,
	type Page,
	type Request,
	type Route
} from '@playwright/test';

const adminUsername = 'admin';
const adminPassword = 'Correct-Horse-Battery-Staple-42!';
const v7CredentialName = 'V7 Browser Password';
const v7ImportedCredentialName = 'V7 Imported SSH password';
const v7ImportedSshName = 'V7 Imported SSH';
const v7ImportedRdpName = 'V7 Imported RDP';
const v7SshName = 'V7 Browser SSH';
const v7RdpName = 'V7 Browser RDP';
const v7VncName = 'V7 Browser VNC';
const v7TelnetName = 'V7 Browser Telnet';
const v7FtpName = 'V7 Browser FTP';
const v7FtpsName = 'V7 Browser FTPS';
const v7UiCredentialName = 'V7 UI CRUD Password';
const v7UiCredentialRotatedName = 'V7 UI CRUD Password Rotated';
const v7UiHostName = 'V7 UI CRUD SSH';
const v7UiHostRenamedName = 'V7 UI CRUD SSH Renamed';
const v7DeniedUsername = 'v7-non-admin-denied';
const v7DeniedPassword = 'V7-Non-Admin-Denied-42!';
const browserRuntimeErrors = new WeakMap<Page, string[]>();

test.describe.serial('V7 operator workflow hardening', () => {
	test.beforeEach(({ page }) => {
		const errors: string[] = [];
		browserRuntimeErrors.set(page, errors);
		page.on('pageerror', (error) => {
			errors.push(`pageerror: ${error.message}`);
		});
		page.on('console', (message) => {
			if (message.type() === 'error' && !isExpectedBrowserConsoleError(message.text())) {
				errors.push(`console.error: ${message.text()}`);
			}
		});
		page.on('requestfailed', (request) => {
			if (isExpectedRequestAbort(request.url(), request.failure()?.errorText)) return;
			errors.push(
				`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`
			);
		});
	});

	test.afterEach(({ page }) => {
		expect(browserRuntimeErrors.get(page) ?? []).toEqual([]);
	});

	test('requires auth for protected routes and restores access after login', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await context.clearCookies();

		await page.goto('/settings');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

		await signIn(page);
		await expect(page).toHaveURL(/\/hosts$/);

		await page.goto('/settings');
		await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	});

	test('shows credential-backed hosts in inventory without exposing secrets', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		const credential = await seedCredential(page, {
			name: v7CredentialName,
			kind: 'password',
			username: 'v7-operator',
			secret: 'v7-local-secret'
		});
		await seedCoreHosts(page, credential.id);

		await page.goto('/credentials');
		await expect(page.getByRole('heading', { name: 'Credentials' })).toBeVisible();
		await page.getByPlaceholder('Filter credentials by name, username, or kind').fill('V7 Browser');
		await expect(page.getByRole('cell', { name: v7CredentialName, exact: true })).toBeVisible();
		await expect(page.getByText('redacted', { exact: true })).toBeVisible();
		await expect(page.getByText('v7-local-secret')).toHaveCount(0);

		await page.goto('/hosts');
		await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();
		await page.getByPlaceholder('Search name, address, folder, or tag').fill('V7 Browser');
		await expect(page.getByText(v7SshName, { exact: true })).toBeVisible();
		await expect(page.getByText(v7RdpName, { exact: true })).toBeVisible();
		await expect(page.getByText(v7VncName, { exact: true })).toBeVisible();
		await expect(page.getByText(v7TelnetName, { exact: true })).toBeVisible();
		await expect(page.getByText(v7FtpName, { exact: true })).toBeVisible();
		await expect(page.getByText(v7FtpsName, { exact: true })).toBeVisible();
		await expect(page.getByRole('cell', { name: v7CredentialName }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: `Launch ${v7SshName}` })).toBeEnabled();
		await expect(page.getByRole('button', { name: `Launch ${v7RdpName}` })).toBeEnabled();
	});

	test('creates, edits, and deletes credentials and hosts through the UI', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await page.setViewportSize({ width: 1400, height: 1200 });

		await page.goto('/credentials');
		await page.getByRole('button', { name: 'Credential' }).click();
		let dialog = page.getByRole('dialog', { name: 'Credential' });
		await dialog.getByLabel('Name', { exact: true }).fill(v7UiCredentialName);
		await dialog.getByLabel('Username', { exact: true }).fill('v7-ui-operator');
		await dialog.getByLabel('Password', { exact: true }).fill('v7-ui-secret');
		await dialog.getByRole('button', { name: 'Save credential' }).click();

		await page
			.getByPlaceholder('Filter credentials by name, username, or kind')
			.fill(v7UiCredentialName);
		await expect(page.getByRole('cell', { name: v7UiCredentialName, exact: true })).toBeVisible();
		await expect(page.getByRole('cell', { name: 'v7-ui-operator', exact: true })).toBeVisible();
		await expect(page.getByText('v7-ui-secret')).toHaveCount(0);

		await page.getByRole('button', { name: `Edit ${v7UiCredentialName}` }).click();
		dialog = page.getByRole('dialog', { name: 'Edit credential' });
		await dialog.getByLabel('Name', { exact: true }).fill(v7UiCredentialRotatedName);
		await dialog.getByRole('button', { name: 'Save changes' }).click();
		await page
			.getByPlaceholder('Filter credentials by name, username, or kind')
			.fill(v7UiCredentialRotatedName);
		await expect(
			page.getByRole('cell', { name: v7UiCredentialRotatedName, exact: true })
		).toBeVisible();

		await page.goto('/hosts');
		await page.getByRole('button', { name: 'Host', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Host configuration' });
		await dialog.getByLabel('Name', { exact: true }).fill(v7UiHostName);
		await dialog.getByLabel('Hostname', { exact: true }).fill('v7-ui-host.example.test');
		await dialog.getByLabel('Port', { exact: true }).fill('2022');
		await dialog.getByLabel('Username', { exact: true }).fill('v7-ui-operator');
		await dialog.getByLabel('Folder', { exact: true }).fill('V7/UI CRUD');
		await dialog.getByLabel('Tags', { exact: true }).fill('ui-crud, deterministic');
		await dialog
			.getByLabel('Notes', { exact: true })
			.fill('Created by V7 browser workflow coverage.');
		await dialog.getByRole('button', { name: 'Save host' }).click({ force: true });

		await page.getByPlaceholder('Search name, address, folder, or tag').fill(v7UiHostName);
		await expect(page.getByText(v7UiHostName, { exact: true })).toBeVisible();
		await expect(page.getByText('v7-ui-operator@v7-ui-host.example.test:2022')).toBeVisible();
		await expect(page.getByText('V7/UI CRUD')).toBeVisible();

		await page.getByRole('button', { name: `Edit ${v7UiHostName}` }).click();
		dialog = page.getByRole('dialog', { name: 'Edit host' });
		await dialog.getByLabel('Name', { exact: true }).fill(v7UiHostRenamedName);
		await dialog.getByLabel('Port', { exact: true }).fill('2023');
		await dialog.getByRole('button', { name: 'Save changes' }).click({ force: true });
		await page.getByPlaceholder('Search name, address, folder, or tag').fill(v7UiHostRenamedName);
		await expect(page.getByText(v7UiHostRenamedName, { exact: true })).toBeVisible();
		await expect(page.getByText('v7-ui-operator@v7-ui-host.example.test:2023')).toBeVisible();

		await page.getByRole('button', { name: `Delete ${v7UiHostRenamedName}` }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete host' }).click();
		await expect(page.getByText(v7UiHostRenamedName, { exact: true })).toHaveCount(0);

		await page.goto('/credentials');
		await page
			.getByPlaceholder('Filter credentials by name, username, or kind')
			.fill(v7UiCredentialRotatedName);
		await page.getByRole('button', { name: `Delete ${v7UiCredentialRotatedName}` }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete credential' }).click();
		await expect(page.getByText(v7UiCredentialRotatedName, { exact: true })).toHaveCount(0);
	});

	test('validates and imports a local Termix export from the importer UI', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await page.goto('/import');

		await expect(page.getByRole('heading', { name: 'Termix import' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Validate only' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Start import' })).toBeDisabled();

		await page.getByLabel('Source file').setInputFiles({
			name: 'v7-termix-export.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(v7ImportFixture()))
		});
		await expect(page.getByRole('button', { name: 'Validate only' })).toBeEnabled();

		await page.getByRole('button', { name: 'Validate only' }).click();
		await expect(page.getByText('Validation completed', { exact: true })).toBeVisible();
		await expect(page.getByText(v7ImportedSshName, { exact: true })).toBeVisible();
		await expect(page.getByText('v7-import.example.test', { exact: false })).toBeVisible();
		await expect(page.getByText('source-user-1:', { exact: false })).toBeVisible();
		await expect(page.getByText('0 hosts imported', { exact: true })).toBeVisible();
		await expect(page.getByText('Validated v7-termix-export.json', { exact: true })).toBeVisible();

		await page.getByRole('button', { name: 'Start import' }).click();
		await expect(page.getByText('Import completed', { exact: true })).toBeVisible();
		await expect(page.getByText('2 hosts imported', { exact: true })).toBeVisible();
		await expect(page.getByText('Imported v7-termix-export.json', { exact: true })).toBeVisible();

		await page.goto('/hosts');
		await page.getByPlaceholder('Search name, address, folder, or tag').fill('V7 Imported');
		await expect(page.getByText(v7ImportedSshName, { exact: true })).toBeVisible();
		await expect(page.getByText(v7ImportedRdpName, { exact: true })).toBeVisible();

		await page.goto('/credentials');
		await page
			.getByPlaceholder('Filter credentials by name, username, or kind')
			.fill('V7 Imported');
		await expect(
			page.getByRole('cell', { name: v7ImportedCredentialName, exact: true })
		).toBeVisible();
		await expect(page.getByText('imported-secret')).toHaveCount(0);
	});

	test('exposes deterministic session launcher affordances without external targets', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await seedCoreHosts(page);

		await page.goto('/sessions');
		await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
		await expect(
			page.getByText('Choose a host from the inventory before launching a session.')
		).toBeVisible();

		const protocolFilters = page.getByLabel('Protocol filters');
		for (const label of ['All', 'SSH', 'SFTP', 'RDP', 'VNC', 'TELNET', 'FTP', 'FTPS', 'Tunnel']) {
			await expect(protocolFilters.getByRole('button', { name: label, exact: true })).toBeVisible();
		}

		await protocolFilters.getByRole('button', { name: 'RDP', exact: true }).click();
		await expect(page).toHaveURL(/\/sessions\?tab=rdp$/);
		await expect(page.getByText('Select a RDP host', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: new RegExp(v7RdpName) })).toBeVisible();
		await expect(page.getByRole('button', { name: new RegExp(v7SshName) })).toHaveCount(0);

		await page
			.getByPlaceholder('Search hosts by name, address, folder, or tag')
			.fill('not-a-v7-host');
		await expect(page.getByText('No matching hosts', { exact: true })).toBeVisible();
		await page.getByPlaceholder('Search hosts by name, address, folder, or tag').fill('');

		await protocolFilters.getByRole('button', { name: 'SFTP', exact: true }).click();
		await expect(page.getByText('Select a SFTP host', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: new RegExp(v7SshName) })).toBeVisible();
	});

	test('opens deterministic workspace panes for each V7 protocol without external targets', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await seedCoreHosts(page);
		const hosts = await listHosts(page);
		const byName = (name: string) => {
			const host = hosts.find((candidate) => candidate.name === name);
			expect(host, `seeded host ${name}`).toBeTruthy();
			return host!;
		};

		await expectWorkspacePane(page, byName(v7SshName).id, 'ssh', [
			v7SshName,
			'SSH session',
			'SSH tabs available',
			'Existing live sessions are idle.'
		]);
		await expectWorkspacePane(page, byName(v7SshName).id, 'sftp', [v7SshName, 'SFTP session']);
		await expect(page.getByRole('region', { name: 'SFTP file manager' })).toBeVisible();
		await expect(page.getByLabel('Remote path')).toBeVisible();
		await expectWorkspacePane(page, byName(v7RdpName).id, 'rdp', [v7RdpName, 'RDP launch failed']);
		await page.getByRole('button', { name: 'Close session' }).click();
		await expect(page.getByText('Disconnected. Reconnect to create a new session.')).toBeVisible();
		await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await expect(page.getByText('RDP launch failed', { exact: false }).first()).toBeVisible();
		await expectWorkspacePane(page, byName(v7VncName).id, 'vnc', [
			v7VncName,
			'VNC session',
			'VNC not connected'
		]);
		await page.getByRole('button', { name: 'Close session' }).click();
		await expect(page.getByText('VNC disconnected', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await expect(page.getByText('VNC not connected', { exact: true })).toBeVisible();
		await expectWorkspacePane(page, byName(v7TelnetName).id, 'telnet', [
			v7TelnetName,
			'TELNET session',
			'Telnet terminal',
			'target connection failed'
		]);
		await page.getByRole('button', { name: 'Close session' }).click();
		await expect(page.getByText('Telnet disconnected', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await expect(page.getByText('Telnet terminal', { exact: true })).toBeVisible();
		await expect(page.getByText('state_unsafe_mutation')).toHaveCount(0);
	});

	test('drives browser file-manager actions for SFTP, FTP, and FTPS without external targets', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await seedCoreHosts(page);
		const hosts = await listHosts(page);
		const sshHost = hosts.find((host) => host.name === v7SshName);
		const ftpHost = hosts.find((host) => host.name === v7FtpName);
		const ftpsHost = hosts.find((host) => host.name === v7FtpsName);
		expect(sshHost, `seeded host ${v7SshName}`).toBeTruthy();
		expect(ftpHost, `seeded host ${v7FtpName}`).toBeTruthy();
		expect(ftpsHost, `seeded host ${v7FtpsName}`).toBeTruthy();

		for (const target of [
			{ hostId: sshHost!.id, tab: 'sftp', apiBase: 'sftp', label: 'SFTP' },
			{ hostId: ftpHost!.id, tab: 'ftp', apiBase: 'ftp', label: 'FTP' },
			{ hostId: ftpsHost!.id, tab: 'ftps', apiBase: 'ftp', label: 'FTPS' }
		] as const) {
			const fixture = await installFileManagerFixture(page, target.apiBase);
			await exerciseFileManager(page, target.hostId, target.tab, target.label, fixture);
			await fixture.dispose();
		}
	});

	test('surfaces FTP and FTPS file-manager launch states from the workspace', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await seedCoreHosts(page);
		const hosts = await listHosts(page);
		const ftpHost = hosts.find((host) => host.name === v7FtpName);
		const ftpsHost = hosts.find((host) => host.name === v7FtpsName);
		expect(ftpHost, `seeded host ${v7FtpName}`).toBeTruthy();
		expect(ftpsHost, `seeded host ${v7FtpsName}`).toBeTruthy();

		await expectWorkspacePane(page, ftpHost!.id, 'ftp', [v7FtpName, 'FTP session']);
		await expect(page.getByRole('region', { name: 'FTP file manager' })).toBeVisible();
		await expect(page.getByLabel('Remote path')).toBeVisible();
		await expectWorkspacePane(page, ftpsHost!.id, 'ftps', [v7FtpsName, 'FTPS session']);
		await expect(page.getByRole('region', { name: 'FTPS file manager' })).toBeVisible();
		await expect(page.getByLabel('Remote path')).toBeVisible();
	});

	test('covers fleet no-target and approval-required review states', async ({ context, page }) => {
		await ensureAdminSession(page, context);
		await seedCoreHosts(page);

		await page.goto('/fleet');
		await expect(page.getByRole('heading', { name: 'Fleet operations' })).toBeVisible();
		const operationsPanel = page.getByRole('tabpanel', { name: 'Operations' });
		await expect(operationsPanel.getByText('Bulk operations', { exact: true })).toBeVisible();

		const visibleToggle = operationsPanel.getByRole('button', {
			name: /^(Select visible|Clear visible)$/
		});
		if ((await visibleToggle.textContent())?.includes('Select visible')) {
			await visibleToggle.click();
			await expect(visibleToggle).toContainText('Clear visible');
		}
		await visibleToggle.click();
		await expect(operationsPanel.getByText('No targets selected.', { exact: true })).toBeVisible();
		await expect(
			operationsPanel.getByText('Select at least one target.', { exact: true })
		).toBeVisible();
		await expect(operationsPanel.getByRole('button', { name: 'Queue operation' })).toBeDisabled();

		await operationsPanel.getByPlaceholder('Search host, owner, tag, OS').fill(v7SshName);
		await operationsPanel.getByRole('button', { name: 'Select visible' }).click();
		await expect(operationsPanel.getByText('Approval required before execution')).toBeVisible();
		await expect(operationsPanel.getByText(v7SshName, { exact: true }).first()).toBeVisible();
		await expect(operationsPanel.getByRole('button', { name: 'Queue operation' })).toBeEnabled();

		await page.getByRole('tab', { name: 'Policies' }).click();
		await expect(page.getByRole('tabpanel', { name: 'Policies' })).toContainText(
			'Workspace policies and approvals'
		);
	});

	test('surfaces admin views and local user management actions', async ({ context, page }) => {
		await ensureAdminSession(page, context);
		await seedCoreHosts(page);

		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
		for (const tab of [
			'Users',
			'Workspaces',
			'Live sessions',
			'Tunnels',
			'FTP/FTPS',
			'History',
			'Settings'
		]) {
			await expect(page.getByRole('tab', { name: tab })).toBeVisible();
		}

		const v7OperatorRow = page.getByRole('row', { name: /v7-browser-operator .* User/ });
		if ((await v7OperatorRow.count()) === 0) {
			await page.getByLabel('Username').fill('v7-browser-operator');
			await page.getByLabel('Password').fill('V7-Browser-Operator-42!');
			await page.getByRole('button', { name: 'Create' }).click();
			await expect(page.getByText('Created v7-browser-operator.', { exact: true })).toBeVisible();
		}
		await expect(v7OperatorRow).toBeVisible();

		await page.getByRole('tab', { name: 'Settings' }).click();
		await expect(page.getByRole('tabpanel', { name: 'Settings' })).toContainText(
			'Application settings'
		);
		await page.getByRole('link', { name: 'App settings' }).click();
		await expect(page).toHaveURL(/\/settings$/);
		await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	});

	test('denies admin-only UI and server data to non-admin users', async ({
		browser,
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await seedCoreHosts(page);
		const adminHosts = await listHosts(page);
		const adminSshHost = adminHosts.find((host) => host.name === v7SshName);
		const adminFtpHost = adminHosts.find((host) => host.name === v7FtpName);
		expect(adminSshHost, `seeded host ${v7SshName}`).toBeTruthy();
		expect(adminFtpHost, `seeded host ${v7FtpName}`).toBeTruthy();
		await ensureLocalUser(page, {
			username: v7DeniedUsername,
			password: v7DeniedPassword,
			isAdmin: false
		});

		const deniedContext = await browser.newContext();
		const deniedPage = await deniedContext.newPage();
		try {
			await deniedPage.goto('/login');
			await signIn(deniedPage, {
				username: v7DeniedUsername,
				password: v7DeniedPassword
			});
			await expect(deniedPage).toHaveURL(/\/hosts$/);

			const response = await deniedPage.goto('/admin');
			expect(response?.status()).toBe(403);
			await expect(deniedPage.getByText('Admin access required')).toBeVisible();

			const serverResponse = await deniedPage.request.get('/admin');
			expect(serverResponse.status()).toBe(403);

			const ticketResponse = await deniedPage.request.post('/api/session-tickets', {
				data: { hostId: adminSshHost!.id, protocol: 'ssh', ttlMs: 60_000 }
			});
			expect(ticketResponse.status()).toBe(400);
			await expectJsonIssues(ticketResponse, [
				'hostId must reference an existing host owned by the user'
			]);

			const ftpResponse = await deniedPage.request.get(
				`/api/ftp/${encodeURIComponent(adminFtpHost!.id)}/list?path=/`
			);
			expect(ftpResponse.status()).toBe(404);
		} finally {
			await deniedContext.close();
		}
	});
});

async function ensureAdminSession(page: Page, context: BrowserContext) {
	await page.goto('/hosts');

	if (/\/first-run$/.test(page.url())) {
		await page.getByLabel('Username').fill(adminUsername);
		await page.getByLabel('Password', { exact: true }).fill(adminPassword);
		await page.getByLabel('Confirm password').fill(adminPassword);
		await page.getByRole('button', { name: 'Create admin' }).click();
	}

	if (/\/login$/.test(page.url())) {
		await signIn(page);
	}

	await expect(page).toHaveURL(/\/hosts$/);
	await expectAuthenticatedHostsApi(page, context);
}

async function signIn(
	page: Page,
	credentials: { username: string; password: string } = {
		username: adminUsername,
		password: adminPassword
	}
) {
	await page.getByLabel('Username', { exact: true }).fill(credentials.username);
	await page.getByLabel('Password', { exact: true }).fill(credentials.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

async function expectAuthenticatedHostsApi(page: Page, context: BrowserContext) {
	const cookies = await context.cookies();
	expect(cookies.some((cookie) => cookie.name === 'termixkit_session')).toBe(true);

	const response = await page.request.get('/api/hosts');
	expect(response.status()).toBe(200);
	const body = (await response.json()) as { hosts?: unknown };
	expect(Array.isArray(body.hosts)).toBe(true);
}

async function expectJsonIssues(response: APIResponse, issues: string[]) {
	const body = (await response.json()) as { issues?: unknown };
	expect(body.issues).toEqual(issues);
}

async function seedCredential(
	page: Page,
	input: { name: string; kind: 'password' | 'ssh_key'; username: string; secret: string }
) {
	const existing = await listCredentials(page);
	const match = existing.find((credential) => credential.name === input.name);
	if (match) return match;

	const response = await page.request.post('/api/credentials', { data: input });
	expect(response.status()).toBe(201);
	const body = (await response.json()) as { credential: { id: string; name: string } };
	return body.credential;
}

async function seedCoreHosts(page: Page, credentialId?: string) {
	const existing = await listHosts(page);
	const existingNames = new Set(existing.map((host) => host.name));
	const hosts = [
		{
			name: v7SshName,
			protocol: 'ssh',
			hostname: 'v7-ssh.example.test',
			port: 22,
			username: 'v7-operator',
			credentialId: credentialId ?? null,
			folder: 'V7/Production',
			tags: ['production', 'critical', 'region:ams']
		},
		{
			name: v7RdpName,
			protocol: 'rdp',
			hostname: 'v7-rdp.example.test',
			port: 3389,
			username: 'administrator',
			credentialId: credentialId ?? null,
			folder: 'V7/Windows',
			tags: ['production', 'region:fra']
		},
		{
			name: v7VncName,
			protocol: 'vnc',
			hostname: 'v7-vnc.example.test',
			port: 5900,
			username: 'vnc-operator',
			credentialId: credentialId ?? null,
			folder: 'V7/Remote Desktop',
			tags: ['production', 'region:ams']
		},
		{
			name: v7TelnetName,
			protocol: 'telnet',
			hostname: 'v7-console.example.test',
			port: 23,
			username: 'console',
			credentialId: null,
			folder: 'V7/Lab',
			tags: ['lab', 'region:lab']
		},
		{
			name: v7FtpName,
			protocol: 'ftp',
			hostname: 'v7-ftp.example.test',
			port: 21,
			username: 'ftp-operator',
			credentialId: credentialId ?? null,
			folder: 'V7/File Transfer',
			tags: ['files', 'region:ams']
		},
		{
			name: v7FtpsName,
			protocol: 'ftps',
			hostname: 'v7-ftps.example.test',
			port: 21,
			username: 'ftps-operator',
			credentialId: credentialId ?? null,
			folder: 'V7/File Transfer',
			tags: ['files', 'tls', 'region:fra'],
			metadata: {
				ftps: {
					mode: 'explicit',
					rejectUnauthorized: true,
					certificateHostname: 'v7-ftps.example.test'
				}
			}
		}
	];

	for (const host of hosts) {
		if (existingNames.has(host.name)) continue;
		const response = await page.request.post('/api/hosts', { data: host });
		expect(response.status()).toBe(201);
	}
}

async function listHosts(page: Page) {
	const response = await page.request.get('/api/hosts');
	expect(response.status()).toBe(200);
	const body = (await response.json()) as {
		hosts: Array<{ id: string; name: string; protocol: string }>;
	};
	return body.hosts;
}

async function listCredentials(page: Page) {
	const response = await page.request.get('/api/credentials');
	expect(response.status()).toBe(200);
	const body = (await response.json()) as { credentials: Array<{ id: string; name: string }> };
	return body.credentials;
}

async function expectWorkspacePane(
	page: Page,
	hostId: string,
	protocol: string,
	expectedTexts: string[]
) {
	await page.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=${protocol}`);
	await expect(page).toHaveURL(new RegExp(`/sessions\\?host=${hostId}.*tab=${protocol}`));
	for (const text of expectedTexts) {
		await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
	}
}

async function exerciseFileManager(
	page: Page,
	hostId: string,
	tab: 'sftp' | 'ftp' | 'ftps',
	label: 'SFTP' | 'FTP' | 'FTPS',
	fixture: FileManagerFixture
) {
	await page.goto(`/sessions?host=${encodeURIComponent(hostId)}&tab=${tab}`);
	await expect(page).toHaveURL(new RegExp(`/sessions\\?host=${hostId}.*tab=${tab}`));
	const manager = page.getByRole('region', { name: `${label} file manager` });
	await expect(manager).toBeVisible();
	await expect(manager.getByRole('button', { name: 'readme.txt' })).toBeVisible();
	await expect(manager.getByRole('button', { name: 'logs' })).toBeVisible();
	expect(fixture.callsFor('list').some((call) => call.path === '/')).toBe(true);

	await manager.getByLabel('Remote search').fill('nested');
	await manager.getByRole('button', { name: 'Tree search' }).click();
	await expect(manager.getByText('Search results (1)', { exact: true })).toBeVisible();
	await expect(manager.getByRole('button', { name: '/logs/nested.log' })).toBeVisible();
	expect(fixture.callsFor('list').some((call) => call.path === '/logs')).toBe(true);
	await manager.getByRole('button', { name: 'Clear search' }).click();

	await manager.getByLabel('New folder name').fill('reports');
	await manager.getByRole('button', { name: 'Create folder' }).click();
	await expect(manager.getByRole('button', { name: 'reports' })).toBeVisible();
	expect(fixture.callsFor('mkdir').some((call) => call.path === '/reports')).toBe(true);

	await manager.getByLabel('Select readme.txt').click();
	await manager.getByRole('button', { name: 'Open selected text file' }).click();
	await expect(manager.getByText('/readme.txt', { exact: true })).toBeVisible();
	const editor = manager.getByPlaceholder('Open a text file to edit it');
	await expect(editor).toHaveValue('Fixture readme for browser workflow coverage.');
	await editor.fill(`${label} saved text`);
	await manager.getByRole('button', { name: 'Save text file' }).click();
	expect(
		fixture
			.callsFor('text')
			.some((call) => call.method === 'PUT' && call.text === `${label} saved text`)
	).toBe(true);

	await manager.getByLabel('Select readme.txt').click();
	await manager.getByLabel('Rename or move target path').fill('/readme-renamed.txt');
	await manager.getByRole('button', { name: 'Rename or move selected path' }).click();
	await expect(manager.getByRole('button', { name: 'readme-renamed.txt' })).toBeVisible();
	expect(
		fixture
			.callsFor('rename')
			.some((call) => call.from === '/readme.txt' && call.to === '/readme-renamed.txt')
	).toBe(true);

	await manager.getByLabel('Upload files').setInputFiles({
		name: 'upload.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from(`${label} uploaded payload`)
	});
	await expect(manager.getByRole('button', { name: 'upload.txt' })).toBeVisible();
	expect(fixture.callsFor('upload').some((call) => call.path === '/upload.txt')).toBe(true);

	await manager.getByLabel('Select upload.txt').click();
	await manager.getByRole('button', { name: 'Download selected paths' }).click();
	await expect(manager.getByText('Downloading 1 file', { exact: false })).toBeVisible();
	expect(fixture.callsFor('download').some((call) => call.path === '/upload.txt')).toBe(true);

	await manager.getByLabel('Select stale.tmp').click();
	await manager.getByRole('button', { name: 'Delete selected paths' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete selected' }).click();
	await expect(manager.getByRole('button', { name: 'stale.tmp' })).toHaveCount(0);
	expect(fixture.callsFor('delete').some((call) => call.path === '/stale.tmp')).toBe(true);
}

type FileManagerApiBase = 'sftp' | 'ftp';
type FileManagerRouteName = 'delete' | 'download' | 'list' | 'mkdir' | 'rename' | 'text' | 'upload';
type FileManagerCall = {
	route: FileManagerRouteName;
	method: string;
	path?: string;
	from?: string;
	to?: string;
	text?: string;
};
type FileManagerEntry = {
	name: string;
	path: string;
	type: 'directory' | 'file' | 'symlink' | 'other';
	size: number;
	mtime: string | null;
	mode?: number;
	link?: string;
};
type FileManagerFixture = {
	callsFor: (route: FileManagerRouteName) => FileManagerCall[];
	dispose: () => Promise<void>;
};

async function installFileManagerFixture(
	page: Page,
	apiBase: FileManagerApiBase
): Promise<FileManagerFixture> {
	const routePattern = new RegExp(
		`/api/${apiBase}/[^/]+/(list|mkdir|rename|delete|text|upload|download)(?:\\?|$)`
	);
	const calls: FileManagerCall[] = [];
	const entries = new Map<string, FileManagerEntry[]>([
		[
			'/',
			[
				fileEntry('readme.txt', '/readme.txt', 48),
				fileEntry('stale.tmp', '/stale.tmp', 5),
				directoryEntry('logs', '/logs')
			]
		],
		['/logs', [fileEntry('nested.log', '/logs/nested.log', 12)]]
	]);
	const textFiles = new Map<string, string>([
		['/readme.txt', 'Fixture readme for browser workflow coverage.']
	]);

	await page.route(routePattern, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const routeName = url.pathname.split('/').at(-1) as FileManagerRouteName;
		const method = request.method();
		const queryPath = normalizeFixturePath(url.searchParams.get('path') ?? '/');
		const body = await requestJson(request);
		const call: FileManagerCall = { route: routeName, method, path: queryPath };
		calls.push(call);

		if (routeName === 'list') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ path: queryPath, entries: entries.get(queryPath) ?? [] })
			});
			return;
		}

		if (routeName === 'mkdir') {
			const path = normalizeFixturePath(stringBodyValue(body, 'path'));
			call.path = path;
			addEntry(entries, directoryEntry(basenameFixture(path), path));
			await jsonOk(route, { path });
			return;
		}

		if (routeName === 'rename') {
			const from = normalizeFixturePath(stringBodyValue(body, 'from'));
			const to = normalizeFixturePath(stringBodyValue(body, 'to'));
			call.from = from;
			call.to = to;
			renameEntry(entries, textFiles, from, to);
			await jsonOk(route, { from, to });
			return;
		}

		if (routeName === 'delete') {
			removeEntry(entries, queryPath);
			textFiles.delete(queryPath);
			await jsonOk(route, { path: queryPath });
			return;
		}

		if (routeName === 'text' && method === 'GET') {
			await jsonOk(route, {
				path: queryPath,
				text: textFiles.get(queryPath) ?? ''
			});
			return;
		}

		if (routeName === 'text' && method === 'PUT') {
			const path = normalizeFixturePath(stringBodyValue(body, 'path'));
			const text = stringBodyValue(body, 'text');
			call.path = path;
			call.text = text;
			textFiles.set(path, text);
			await jsonOk(route, { path, size: Buffer.byteLength(text, 'utf8') });
			return;
		}

		if (routeName === 'upload') {
			const name = basenameFixture(queryPath);
			addEntry(entries, fileEntry(name, queryPath, request.postDataBuffer()?.byteLength ?? 1));
			textFiles.set(queryPath, 'Uploaded through browser fixture.');
			await jsonOk(route, { path: queryPath, size: request.postDataBuffer()?.byteLength ?? 1 });
			return;
		}

		if (routeName === 'download') {
			await route.fulfill({
				status: 200,
				contentType: 'text/plain',
				headers: {
					'content-disposition': `attachment; filename="${basenameFixture(queryPath)}"`
				},
				body: textFiles.get(queryPath) ?? 'downloaded fixture content'
			});
			return;
		}

		await route.continue();
	});

	return {
		callsFor: (route) => calls.filter((call) => call.route === route),
		dispose: () => page.unroute(routePattern)
	};
}

async function requestJson(request: Request) {
	try {
		return (await request.postDataJSON()) as Record<string, unknown>;
	} catch {
		return {};
	}
}

async function jsonOk(route: Route, body: unknown) {
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(body)
	});
}

function directoryEntry(name: string, path: string): FileManagerEntry {
	return {
		name,
		path,
		type: 'directory',
		size: 0,
		mtime: '2026-05-15T10:00:00.000Z',
		mode: 0o755
	};
}

function fileEntry(name: string, path: string, size: number): FileManagerEntry {
	return {
		name,
		path,
		type: 'file',
		size,
		mtime: '2026-05-15T10:00:00.000Z',
		mode: 0o644
	};
}

function addEntry(entries: Map<string, FileManagerEntry[]>, entry: FileManagerEntry) {
	const directory = dirnameFixture(entry.path);
	const current = entries.get(directory) ?? [];
	entries.set(directory, [...current.filter((candidate) => candidate.path !== entry.path), entry]);
	if (entry.type === 'directory' && !entries.has(entry.path)) entries.set(entry.path, []);
}

function renameEntry(
	entries: Map<string, FileManagerEntry[]>,
	textFiles: Map<string, string>,
	from: string,
	to: string
) {
	const fromDirectory = dirnameFixture(from);
	const source = entries.get(fromDirectory)?.find((entry) => entry.path === from);
	if (!source) return;
	removeEntry(entries, from);
	addEntry(entries, { ...source, name: basenameFixture(to), path: to });
	const text = textFiles.get(from);
	if (typeof text === 'string') {
		textFiles.delete(from);
		textFiles.set(to, text);
	}
}

function removeEntry(entries: Map<string, FileManagerEntry[]>, path: string) {
	const directory = dirnameFixture(path);
	entries.set(
		directory,
		(entries.get(directory) ?? []).filter((entry) => entry.path !== path)
	);
	entries.delete(path);
}

function stringBodyValue(body: Record<string, unknown>, key: string) {
	const value = body[key];
	return typeof value === 'string' ? value : '';
}

function normalizeFixturePath(value: string) {
	const path = value.trim().startsWith('/') ? value.trim() : `/${value.trim()}`;
	return path.replace(/\/+/g, '/') || '/';
}

function dirnameFixture(path: string) {
	const parts = normalizeFixturePath(path).split('/').filter(Boolean);
	parts.pop();
	return parts.length ? `/${parts.join('/')}` : '/';
}

function basenameFixture(path: string) {
	return normalizeFixturePath(path).split('/').filter(Boolean).pop() ?? '/';
}

function isExpectedBrowserConsoleError(message: string) {
	if (message.includes('Failed to load resource') && message.includes('500')) return true;
	return message.includes(
		'Failed when connecting: Connection closed (code: 1011, reason: target connection failed)'
	);
}

function isExpectedRequestAbort(url: string, errorText: string | undefined) {
	return url.startsWith('http://127.0.0.1:4173/') && errorText === 'net::ERR_ABORTED';
}

async function ensureLocalUser(
	page: Page,
	input: { username: string; password: string; isAdmin: boolean }
) {
	const existing = await page.request.get('/api/hosts');
	expect(existing.status()).toBe(200);

	await page.goto('/admin');
	const userRow = page.getByRole('row', { name: new RegExp(`${input.username} .* User`) });
	if ((await userRow.count()) > 0) return;

	await page.getByLabel('Username', { exact: true }).fill(input.username);
	await page.getByLabel('Password', { exact: true }).fill(input.password);
	if (input.isAdmin) {
		await page.getByLabel('Create as admin').check();
	}
	await page.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByText(`Created ${input.username}.`, { exact: true })).toBeVisible();
}

function v7ImportFixture() {
	return {
		records: [
			{
				id: 'v7-import-ssh',
				name: v7ImportedSshName,
				protocol: 'ssh',
				hostname: 'v7-import.example.test',
				username: 'importer',
				password: 'imported-secret',
				folder: 'V7/Imported',
				tags: 'production, imported, region:ams'
			},
			{
				id: 'v7-import-rdp',
				name: v7ImportedRdpName,
				protocol: 'rdp',
				hostname: 'v7-import-rdp.example.test',
				username: 'administrator',
				folder: 'V7/Imported',
				tags: ['imported', 'region:fra']
			},
			{
				id: 'v7-import-missing-host',
				name: 'V7 Skipped Missing Host',
				protocol: 'ssh'
			}
		],
		users: [
			{
				id: 'source-user-1',
				email: 'source-user-1@example.test',
				password_hash: '$2b$10$v7-local-fixture'
			}
		]
	};
}
