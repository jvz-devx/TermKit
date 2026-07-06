import { expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { fileEntry, installFileManagerFixture } from './v7-file-manager-fixture';

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
		const suffix = Date.now().toString(36);
		const credentialName = `${v7UiCredentialName} ${suffix}`;
		const rotatedCredentialName = `${v7UiCredentialRotatedName} ${suffix}`;
		const hostName = `${v7UiHostName} ${suffix}`;
		const renamedHostName = `${v7UiHostRenamedName} ${suffix}`;

		await page.goto('/credentials');
		await page.getByRole('button', { name: 'Credential' }).click();
		let dialog = page.getByRole('dialog', { name: 'Credential' });
		await dialog.getByLabel('Name', { exact: true }).fill(credentialName);
		await dialog.getByLabel('Username', { exact: true }).fill('v7-ui-operator');
		await dialog.getByLabel('Password', { exact: true }).fill('v7-ui-secret');
		await dialog.getByRole('button', { name: 'Save credential' }).click();

		await page
			.getByPlaceholder('Filter credentials by name, username, or kind')
			.fill(credentialName);
		await expect(page.getByRole('cell', { name: credentialName, exact: true })).toBeVisible();
		await expect(page.getByRole('cell', { name: 'v7-ui-operator', exact: true })).toBeVisible();
		await expect(page.getByText('v7-ui-secret')).toHaveCount(0);

		await page.getByRole('button', { name: `Edit ${credentialName}` }).click();
		dialog = page.getByRole('dialog', { name: 'Edit credential' });
		await dialog.getByLabel('Name', { exact: true }).fill(rotatedCredentialName);
		await dialog.getByRole('button', { name: 'Save changes' }).click();
		await page
			.getByPlaceholder('Filter credentials by name, username, or kind')
			.fill(rotatedCredentialName);
		await expect(
			page.getByRole('cell', { name: rotatedCredentialName, exact: true })
		).toBeVisible();

		await page.goto('/hosts');
		await page.getByRole('button', { name: 'Host', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Host configuration' });
		await dialog.getByLabel('Name', { exact: true }).fill(hostName);
		await dialog.getByLabel('Hostname', { exact: true }).fill('v7-ui-host.example.test');
		await dialog.getByLabel('Port', { exact: true }).fill('2022');
		await dialog.getByLabel('Username', { exact: true }).fill('v7-ui-operator');
		await dialog.getByLabel('Folder', { exact: true }).fill('V7/UI CRUD');
		await dialog.getByLabel('Tags', { exact: true }).fill('ui-crud, deterministic');
		await dialog
			.getByLabel('Notes', { exact: true })
			.fill('Created by V7 browser workflow coverage.');
		await dialog.getByRole('button', { name: 'Save host' }).click({ force: true });

		await page.getByPlaceholder('Search name, address, folder, or tag').fill(hostName);
		await expect(page.getByText(hostName, { exact: true })).toBeVisible();
		await expect(page.getByText('v7-ui-operator@v7-ui-host.example.test:2022')).toBeVisible();
		await expect(page.getByText('V7/UI CRUD')).toBeVisible();

		await page.getByRole('button', { name: `Edit ${hostName}` }).click();
		dialog = page.getByRole('dialog', { name: 'Edit host' });
		await dialog.getByLabel('Name', { exact: true }).fill(renamedHostName);
		await dialog.getByLabel('Port', { exact: true }).fill('2023');
		await dialog.getByRole('button', { name: 'Save changes' }).click({ force: true });
		await page.getByPlaceholder('Search name, address, folder, or tag').fill(renamedHostName);
		await expect(page.getByText(renamedHostName, { exact: true })).toBeVisible();
		await expect(page.getByText('v7-ui-operator@v7-ui-host.example.test:2023')).toBeVisible();

		await page.getByRole('button', { name: `Delete ${renamedHostName}` }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete host' }).click();
		await expect(page.getByText(renamedHostName, { exact: true })).toHaveCount(0);

		await page.goto('/credentials');
		await page
			.getByPlaceholder('Filter credentials by name, username, or kind')
			.fill(rotatedCredentialName);
		await page.getByRole('button', { name: `Delete ${rotatedCredentialName}` }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete credential' }).click();
		await expect(page.getByText(rotatedCredentialName, { exact: true })).toHaveCount(0);
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
		await expect(page.getByRole('heading', { name: 'Persistent Sessions' })).toBeVisible();
		await expect(
			page.getByText('Choose a host from the inventory before launching a session.')
		).toBeVisible();
		await test.info().attach('persistent-sessions-launcher', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-sessions-launcher.png')
			}),
			contentType: 'image/png'
		});

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
			'Attach an existing live tab or create a new SSH tab.'
		]);
		await expect(page.getByRole('button', { name: 'Split pane right' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Split pane down' })).toBeVisible();
		await expect(page.getByText('Split right', { exact: true })).toBeVisible();
		await expect(page.getByText('Split down', { exact: true })).toBeVisible();
		await test.info().attach('persistent-tmux-controls', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-tmux-controls.png')
			}),
			contentType: 'image/png'
		});
		await page.getByRole('button', { name: 'Attach tab' }).click();
		await expect(
			page.getByRole('tab', { name: new RegExp(`Active SSH tab ${v7SshName}`) })
		).toBeVisible();
		await test.info().attach('persistent-ssh-attached', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-ssh-attached.png')
			}),
			contentType: 'image/png'
		});
		await page.getByRole('button', { name: `Close SSH tab ${v7SshName}` }).click();
		await expect(page.getByText('SSH disconnected', { exact: true })).toBeVisible();
		await expect(page.getByText('No persistent SSH tabs', { exact: true })).toBeVisible();
		await test.info().attach('persistent-ssh-closed', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-ssh-closed.png')
			}),
			contentType: 'image/png'
		});
		await page.getByRole('button', { name: 'Reconnect', exact: true }).first().click();
		await expect(page.getByText('Opening SSH tab', { exact: true })).toBeVisible();
		await test.info().attach('persistent-ssh-reconnect', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-ssh-reconnect.png')
			}),
			contentType: 'image/png'
		});
		await expectWorkspacePane(page, byName(v7SshName).id, 'sftp', [v7SshName, 'SFTP session']);
		await expect(page.getByRole('region', { name: 'SFTP file manager' })).toBeVisible();
		await expect(page.getByLabel('Remote path')).toBeVisible();
		await expectWorkspacePane(page, byName(v7RdpName).id, 'rdp', [
			v7RdpName,
			'RDP Gateway ready',
			'RDP credentials required'
		]);
		await test.info().attach('persistent-rdp-credentials', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-rdp-credentials.png')
			}),
			contentType: 'image/png'
		});
		const rdpCredentialsDialog = page.getByRole('dialog', { name: 'RDP credentials required' });
		await rdpCredentialsDialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(rdpCredentialsDialog).toBeHidden();
		await expect(page.getByRole('button', { name: 'Split RDP right' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Split RDP down' })).toBeVisible();
		await test.info().attach('persistent-rdp-pane-controls', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-rdp-pane-controls.png')
			}),
			contentType: 'image/png'
		});
		await page.getByRole('button', { name: 'Split RDP right' }).click();
		await expect(page.getByRole('button', { name: 'Split pane down' }).first()).toBeVisible();
		const remountedRdpCredentialsDialog = page.getByRole('dialog', {
			name: 'RDP credentials required'
		});
		if (await remountedRdpCredentialsDialog.isVisible().catch(() => false)) {
			await remountedRdpCredentialsDialog.getByRole('button', { name: 'Cancel' }).click();
			await expect(remountedRdpCredentialsDialog).toBeHidden();
		}
		await page.getByRole('button', { name: 'RDP details and secondary controls' }).first().click();
		await expect(page.getByRole('button', { name: 'Close persistent session' })).toBeVisible();
		await page.waitForTimeout(150);
		await test.info().attach('persistent-rdp-close-control', {
			body: await page.screenshot({
				fullPage: true,
				path: test.info().outputPath('persistent-rdp-close-control.png')
			}),
			contentType: 'image/png'
		});
		await page.getByRole('button', { name: 'Close persistent session' }).click();
		await expect(page.getByText('Remote disconnected', { exact: true })).toBeVisible();
		await expect(page.getByText('Reconnect to attach the RDP session again.')).toBeVisible();
		await page.getByRole('button', { name: 'Reconnect' }).first().click();
		await expect(page.getByText('RDP credentials required', { exact: true }).first()).toBeVisible();
		const reconnectedRdpCredentialsDialog = page.getByRole('dialog', {
			name: 'RDP credentials required'
		});
		if (await reconnectedRdpCredentialsDialog.isVisible().catch(() => false)) {
			await reconnectedRdpCredentialsDialog.getByRole('button', { name: 'Cancel' }).click();
			await expect(reconnectedRdpCredentialsDialog).toBeHidden();
		}
		await page.getByLabel('Single pane').click();
		await expectWorkspacePane(page, byName(v7VncName).id, 'vnc', [
			v7VncName,
			'VNC session',
			'VNC not connected'
		]);
		await page.getByRole('button', { name: 'Close session' }).click();
		await expect(page.getByText('VNC disconnected', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reconnect', exact: true }).first().click();
		await expect(page.getByText('VNC not connected', { exact: true })).toBeVisible();
		await expectWorkspacePane(page, byName(v7TelnetName).id, 'telnet', [
			v7TelnetName,
			'TELNET session',
			'Telnet terminal',
			'Target connection failed. Check the host, port, firewall, and target service before reconnecting.'
		]);
		await page.getByRole('button', { name: 'Close session' }).click();
		await expect(page.getByText('Telnet disconnected', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reconnect', exact: true }).first().click();
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

	test('cancels in-flight browser file-manager transfers without false completion', async ({
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
			const fixture = await installFileManagerFixture(page, target.apiBase, {
				blockedDownloads: ['/abort-b.bin'],
				extraEntries: [
					fileEntry('abort-a.bin', '/abort-a.bin', 256),
					fileEntry('abort-b.bin', '/abort-b.bin', 256)
				],
				textFiles: {
					'/abort-a.bin': 'a'.repeat(256),
					'/abort-b.bin': 'b'.repeat(256)
				}
			});
			await exerciseFileManagerAbort(page, target.hostId, target.tab, target.label, fixture);
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
	expect(cookies.some((cookie) => cookie.name === 'termkit_session')).toBe(true);

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

async function exerciseFileManagerAbort(
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
	await expect(manager.getByRole('button', { name: 'abort-a.bin' })).toBeVisible();
	await expect(manager.getByRole('button', { name: 'abort-b.bin' })).toBeVisible();

	await manager.getByLabel('Select abort-a.bin').click();
	await manager.getByLabel('Select abort-b.bin').click();
	await manager.getByRole('button', { name: 'Download selected paths' }).click();
	await expect(manager.getByText('Downloading 2 files', { exact: false })).toBeVisible();
	await expect
		.poll(() => fixture.callsFor('download').some((call) => call.path === '/abort-b.bin'))
		.toBe(true);
	await expect(manager.getByText('· abort-b.bin', { exact: true })).toBeVisible();

	const abortedDownload = page.waitForEvent('requestfailed', {
		predicate: (request) =>
			request.url().includes(`/api/${fixture.apiBase}/`) &&
			request.url().includes('/download') &&
			request.url().includes('abort-b.bin')
	});
	await manager.getByRole('button', { name: 'Cancel' }).click();
	const failedRequest = await abortedDownload;
	await fixture.releaseBlockedDownload('/abort-b.bin', 'abort');
	await expect(manager.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
	await expect(manager.getByText('Downloading 2 files', { exact: false })).toBeVisible();
	await expect(manager.getByText('1/2 items', { exact: true })).toBeVisible();
	await expect(manager.getByText('256 B/512 B', { exact: true })).toBeVisible();
	await expect(manager.getByText('50%', { exact: false })).toBeVisible();
	await expect(manager.getByText('100%', { exact: false })).toHaveCount(0);
	expect(failedRequest.failure()?.errorText ?? '').toMatch(/aborted|ERR_ABORTED/i);
}

function isExpectedBrowserConsoleError(message: string) {
	if (message.includes('Failed to load resource') && message.includes('500')) return true;
	if (message.includes('Tried changing state of a disconnected RFB object')) return true;
	return message.includes(
		'Failed when connecting: Connection closed (code: 1011, reason: target connection failed)'
	);
}

function isExpectedRequestAbort(url: string, errorText: string | undefined) {
	if (errorText !== 'net::ERR_ABORTED') return false;
	const { hostname } = new URL(url);
	return hostname === '127.0.0.1' || hostname === 'localhost';
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
