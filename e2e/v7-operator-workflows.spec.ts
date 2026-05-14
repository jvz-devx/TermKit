import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const adminUsername = 'admin';
const adminPassword = 'Correct-Horse-Battery-Staple-42!';
const v7CredentialName = 'V7 Browser Password';
const v7ImportedCredentialName = 'V7 Imported SSH password';
const v7ImportedSshName = 'V7 Imported SSH';
const v7ImportedRdpName = 'V7 Imported RDP';
const v7SshName = 'V7 Browser SSH';
const v7RdpName = 'V7 Browser RDP';
const v7TelnetName = 'V7 Browser Telnet';

test.describe.serial('V7 operator workflow hardening', () => {
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
		await expect(page.getByText(v7TelnetName, { exact: true })).toBeVisible();
		await expect(page.getByRole('cell', { name: v7CredentialName }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: `Launch ${v7SshName}` })).toBeEnabled();
		await expect(page.getByRole('button', { name: `Launch ${v7RdpName}` })).toBeEnabled();
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

async function signIn(page: Page) {
	await page.getByLabel('Username').fill(adminUsername);
	await page.getByLabel('Password').fill(adminPassword);
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
			name: v7TelnetName,
			protocol: 'telnet',
			hostname: 'v7-console.example.test',
			port: 23,
			username: 'console',
			credentialId: null,
			folder: 'V7/Lab',
			tags: ['lab', 'region:lab']
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
	const body = (await response.json()) as { hosts: Array<{ id: string; name: string }> };
	return body.hosts;
}

async function listCredentials(page: Page) {
	const response = await page.request.get('/api/credentials');
	expect(response.status()).toBe(200);
	const body = (await response.json()) as { credentials: Array<{ id: string; name: string }> };
	return body.credentials;
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
