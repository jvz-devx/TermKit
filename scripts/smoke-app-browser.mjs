import { join } from 'node:path';
import { chromium } from 'playwright';

export async function createAndLoginAdmin({
	baseUrl,
	tempDir,
	smokeUsername,
	smokePassword,
	timeoutMs,
	execFile
}) {
	const context = await chromium.launchPersistentContext(join(tempDir, 'chromium-profile'), {
		headless: true,
		executablePath: await chromiumExecutablePath(execFile),
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

async function chromiumExecutablePath(execFile) {
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
