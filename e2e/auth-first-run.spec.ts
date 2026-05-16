import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

const adminUsername = 'admin';
const adminPassword = 'Correct-Horse-Battery-Staple-42!';

test.describe.serial('application onboarding and navigation', () => {
	test('creates the first admin, redirects to hosts, and allows a fresh login', async ({
		context,
		page
	}) => {
		await page.goto('/');

		await expect(page).toHaveURL(/\/first-run$/);
		await expect(page.getByRole('heading', { name: 'Create admin' })).toBeVisible();

		await page.getByLabel('Username').fill(adminUsername);
		await page.getByLabel('Password', { exact: true }).fill(adminPassword);
		await page.getByLabel('Confirm password').fill(adminPassword);
		await page.getByRole('button', { name: 'Create admin' }).click();

		await expect(page).toHaveURL(/\/hosts$/);
		await expect(await expectAuthenticatedHostsApi(page, context)).toEqual([]);

		await context.clearCookies();
		await page.goto('/hosts');

		await expect(page).toHaveURL(/\/login$/);
		await page.getByLabel('Username').fill(adminUsername);
		await page.getByLabel('Password').fill(adminPassword);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL(/\/hosts$/);
		await expect(await expectAuthenticatedHostsApi(page, context)).toEqual([]);
	});

	test('keeps host inventory out of the sidebar and navigates by application sections', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		const seededHosts = await seedHosts(page);

		await page.goto('/hosts');
		await expect(page.getByRole('heading', { name: 'Hosts' })).toBeVisible();
		for (const host of seededHosts) {
			await expect(page.getByText(host.name, { exact: true })).toBeVisible();
		}

		const sidebar = page.locator('[data-sidebar="sidebar"]').first();
		await expect(sidebar).toContainText('Inventory');
		await expect(sidebar).toContainText('Connections');
		await expect(sidebar).toContainText('Administration');
		await expect(sidebar).toContainText('Hosts');
		await expect(sidebar).toContainText('Credentials');
		await expect(sidebar).toContainText('Import from Termix');
		await expect(sidebar).toContainText('Session workspace');
		await expect(sidebar).toContainText('Fleet operations');
		await expect(sidebar).toContainText('Application');

		for (const host of seededHosts) {
			await expect(sidebar).not.toContainText(host.name);
		}

		await page.getByRole('link', { name: 'Credentials' }).click();
		await expect(page).toHaveURL(/\/credentials$/);
		await expect(page.getByRole('heading', { name: 'Credentials' })).toBeVisible();

		await page.getByRole('link', { name: 'Import from Termix' }).click();
		await expect(page).toHaveURL(/\/import$/);
		await expect(page.getByRole('heading', { name: 'Termix import' })).toBeVisible();

		await expandSidebarGroup(page, 'Connections');
		await page.getByRole('link', { name: 'Session workspace' }).click();
		await expect(page).toHaveURL(/\/sessions$/);
		await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
		const protocolFilters = page.getByLabel('Protocol filters');
		await expect(protocolFilters.getByRole('button', { name: 'All' })).toBeVisible();
		await expect(protocolFilters.getByRole('button', { name: 'SSH' })).toBeVisible();
		await expect(protocolFilters.getByRole('button', { name: 'SFTP' })).toBeVisible();
		await expect(protocolFilters.getByRole('button', { name: 'RDP' })).toBeVisible();
		await expect(protocolFilters.getByRole('button', { name: 'VNC' })).toBeVisible();
		await expect(protocolFilters.getByRole('button', { name: 'Telnet' })).toBeVisible();

		await expandSidebarGroup(page, 'Fleet operations');
		await page.getByRole('link', { name: 'Overview' }).click();
		await expect(page).toHaveURL(/\/fleet$/);
		await expect(page.getByRole('heading', { name: 'Fleet overview' })).toBeVisible();
		await expect(page.getByText('remote functions', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Runbooks', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Targets', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Executions', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Approvals', exact: true })).toBeVisible();

		await page.getByRole('link', { name: 'New execution' }).click();
		await expect(page).toHaveURL(/\/fleet\/executions\/new$/);
		await expect(page.getByRole('heading', { name: 'New execution' })).toBeVisible();
		await expect(page.getByText('1. Runbook', { exact: true })).toBeVisible();
		await expect(page.getByText('2. Operation', { exact: true })).toBeVisible();
		await expect(page.getByText('No targets selected.', { exact: true })).toBeVisible();
		await expect(page.getByText('Select at least one target.', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Queue execution' })).toBeDisabled();
		await expect(page.getByRole('heading', { name: 'Targets' })).toBeVisible();
		await expect(
			page.getByText('3 of 3 targets match the current filters.', { exact: true })
		).toBeVisible();
		for (const host of seededHosts) {
			await expect(page.getByText(host.name, { exact: true })).toBeVisible();
		}
		await page.getByPlaceholder('Search host, owner, tag, OS').fill('missing-fleet-host');
		await expect(
			page.getByText('0 of 3 targets match the current filters.', { exact: true })
		).toBeVisible();
		await expect(page.getByText('No hosts match these filters.', { exact: true })).toBeVisible();

		await expandSidebarGroup(page, 'Administration');
		await page.getByRole('link', { name: 'Application' }).click();
		await expect(page).toHaveURL(/\/settings$/);
		await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	});

	test('switches app theme from the account menu and persists it locally', async ({
		context,
		page
	}) => {
		await ensureAdminSession(page, context);
		await page.goto('/hosts');

		await chooseTheme(page, 'Dark');
		await expect(page.locator('html')).toHaveClass(/dark/);
		expect(await page.evaluate(() => localStorage.getItem('termixkit:theme-mode'))).toBe('dark');

		await page.reload();
		await expect(page.locator('html')).toHaveClass(/dark/);

		await chooseTheme(page, 'Light');
		await expect(page.locator('html')).not.toHaveClass(/dark/);
		expect(await page.evaluate(() => localStorage.getItem('termixkit:theme-mode'))).toBe('light');

		await page.reload();
		await expect(page.locator('html')).not.toHaveClass(/dark/);

		await chooseTheme(page, 'Dark');
		await context.clearCookies();
		await page.goto('/login');
		await expect(page.locator('html')).toHaveClass(/dark/);

		await page.getByLabel('Username').fill(adminUsername);
		await page.getByLabel('Password').fill(adminPassword);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/hosts$/);

		await chooseTheme(page, 'System');
		expect(await page.evaluate(() => localStorage.getItem('termixkit:theme-mode'))).toBe('system');
	});

	test('saves settings and reloads the persisted values', async ({ context, page }) => {
		await ensureAdminSession(page, context);
		await page.goto('/settings');

		const ticketTtl = page.getByLabel('Ticket TTL seconds');
		const terminalFontSize = page.getByLabel('Terminal font size');
		const rdpTextClipboard = page.getByRole('switch', { name: 'RDP text clipboard' });
		const rdpFileClipboard = page.getByRole('switch', { name: 'RDP file clipboard' });
		const rdpClientToRemote = page.getByRole('switch', {
			name: 'RDP client to remote clipboard'
		});
		const rdpRemoteToClient = page.getByRole('switch', {
			name: 'RDP remote to client clipboard'
		});
		const rdpFileLimit = page.getByLabel('File transfer limit (MiB)');
		const rememberLastActiveTab = page.getByRole('switch', {
			name: 'Remember last active tab per host'
		});
		const saveButton = page.getByRole('button', { name: 'Save settings' });

		await expect(ticketTtl).toHaveValue('60');
		await expect(terminalFontSize).toHaveValue('13');
		await expectSwitchState(rdpTextClipboard, true);
		await expectSwitchState(rdpFileClipboard, false);
		await expectSwitchState(rdpClientToRemote, true);
		await expectSwitchState(rdpRemoteToClient, true);
		await expect(rdpFileLimit).toHaveValue('16');
		await expect(rdpFileLimit).toBeDisabled();
		await expect(saveButton).toBeDisabled();

		await ticketTtl.fill('90');
		await terminalFontSize.fill('18');
		await setSwitch(rdpFileClipboard, true);
		await rdpFileLimit.fill('32');
		await setSwitch(rdpTextClipboard, false);
		await setSwitch(rdpClientToRemote, false);
		await setSwitch(rememberLastActiveTab, false);

		await expect(saveButton).toBeEnabled();
		await saveButton.click();
		await expect(page.getByText('Settings saved.', { exact: true })).toBeVisible();
		await expect(saveButton).toBeDisabled();

		await page.reload();
		await expect(ticketTtl).toHaveValue('90');
		await expect(terminalFontSize).toHaveValue('18');
		await expectSwitchState(rdpTextClipboard, false);
		await expectSwitchState(rdpFileClipboard, true);
		await expectSwitchState(rdpClientToRemote, false);
		await expectSwitchState(rdpRemoteToClient, true);
		await expect(rdpFileLimit).toHaveValue('32');
		await expect(rdpFileLimit).toBeEnabled();
		await expectSwitchState(rememberLastActiveTab, false);
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
		await page.getByLabel('Username').fill(adminUsername);
		await page.getByLabel('Password').fill(adminPassword);
		await page.getByRole('button', { name: 'Sign in' }).click();
	}

	await expect(page).toHaveURL(/\/hosts$/);
	await expectAuthenticatedHostsApi(page, context);
}

async function expectAuthenticatedHostsApi(page: Page, context: BrowserContext) {
	const cookies = await context.cookies();
	expect(cookies.some((cookie) => cookie.name === 'termixkit_session')).toBe(true);

	const response = await page.request.get('/api/hosts');

	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(Array.isArray(body.hosts)).toBe(true);
	return body.hosts as Array<{ name: string }>;
}

async function seedHosts(page: Page) {
	const suffix = Date.now().toString(36);
	const hosts = [
		{
			name: `E2E SSH host ${suffix}`,
			protocol: 'ssh',
			hostname: 'prod.example.test',
			port: 22,
			username: 'deploy',
			folder: 'Production',
			tags: ['prod', 'linux']
		},
		{
			name: `E2E RDP host ${suffix}`,
			protocol: 'rdp',
			hostname: 'win.example.test',
			port: 3389,
			username: 'administrator',
			folder: 'Windows',
			tags: ['admin']
		},
		{
			name: `E2E Telnet host ${suffix}`,
			protocol: 'telnet',
			hostname: 'console.lab.test',
			port: 23,
			username: 'operator',
			folder: 'Lab',
			tags: ['console']
		}
	];

	for (const host of hosts) {
		const response = await page.request.post('/api/hosts', { data: host });
		expect(response.status()).toBe(201);
	}

	return hosts;
}

async function expandSidebarGroup(page: Page, name: string) {
	const button = page.getByRole('button', { name: `Toggle ${name} navigation` });
	if ((await button.getAttribute('aria-expanded')) !== 'true') {
		await button.click();
	}
}

async function chooseTheme(page: Page, theme: 'Light' | 'Dark' | 'System') {
	await page.getByRole('button', { name: 'Account menu' }).click();
	await page.getByRole('menuitemradio', { name: theme }).click();
}

async function setSwitch(locator: Locator, checked: boolean) {
	if ((await locator.getAttribute('aria-checked')) !== String(checked)) {
		await locator.click();
	}
	await expectSwitchState(locator, checked);
}

async function expectSwitchState(locator: Locator, checked: boolean) {
	await expect(locator).toHaveAttribute('aria-checked', String(checked));
}
