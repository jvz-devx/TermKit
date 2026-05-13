import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.describe('first-run administrator flow', () => {
	test('creates the first admin, redirects to hosts, and allows a fresh login', async ({
		context,
		page
	}) => {
		const username = 'admin';
		const password = 'Correct-Horse-Battery-Staple-42!';

		await page.goto('/');

		await expect(page).toHaveURL(/\/first-run$/);
		await expect(page.getByRole('heading', { name: 'Create admin' })).toBeVisible();

		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password', { exact: true }).fill(password);
		await page.getByLabel('Confirm password').fill(password);
		await page.getByRole('button', { name: 'Create admin' }).click();

		await expect(page).toHaveURL(/\/hosts$/);
		await expectAuthenticatedHostsApi(page, context);

		await context.clearCookies();
		await page.goto('/hosts');

		await expect(page).toHaveURL(/\/login$/);
		await page.getByLabel('Username').fill(username);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL(/\/hosts$/);
		await expectAuthenticatedHostsApi(page, context);
	});
});

async function expectAuthenticatedHostsApi(page: Page, context: BrowserContext) {
	const cookies = await context.cookies();
	expect(cookies.some((cookie) => cookie.name === 'termixkit_session')).toBe(true);

	const response = await page.request.get('/api/hosts');

	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({ hosts: [] });
}
