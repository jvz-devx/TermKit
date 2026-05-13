import { defineConfig, devices } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT ?? '4173';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
	testDir: './e2e',
	globalTeardown: './e2e/global-teardown.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
	outputDir: 'test-results/e2e',
	timeout: 30_000,
	expect: {
		timeout: 10_000
	},
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: chromiumExecutablePath
					? {
							executablePath: chromiumExecutablePath
						}
					: undefined
			}
		}
	],
	webServer: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: {
				command:
					process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
					'npm run build && exec node scripts/playwright-start-app.mjs',
				url: baseURL,
				reuseExistingServer: false,
				timeout: 180_000,
				env: {
					PLAYWRIGHT_PORT: port
				}
			}
});
