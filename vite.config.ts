import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
		coverage: {
			provider: 'v8',
			reportsDirectory: 'coverage',
			reporter: ['text', 'html', 'json', 'lcov'],
			include: [
				'src/hooks.server.ts',
				'src/lib/**/*.{js,ts}',
				'src/routes/api/**/*.ts',
				'src/routes/(auth)/auth/microsoft/**/*.ts'
			],
			thresholds: {
				statements: 70,
				branches: 65,
				functions: 70,
				lines: 73,
				'src/lib/server/auth/**': {
					statements: 85,
					branches: 85,
					functions: 85,
					lines: 85
				},
				'src/lib/server/crypto/**': {
					statements: 86,
					branches: 84,
					functions: 95,
					lines: 91
				},
				'src/lib/server/import/**': {
					statements: 80,
					branches: 73,
					functions: 90,
					lines: 82
				},
				'src/lib/termix/**': {
					statements: 86,
					branches: 76,
					functions: 96,
					lines: 89
				},
				'src/lib/server/ssh-live/**': {
					statements: 65,
					branches: 63,
					functions: 61,
					lines: 68
				},
				'src/lib/server/services/bulk-job-runner.ts': {
					statements: 82,
					branches: 71,
					functions: 88,
					lines: 88
				},
				'src/lib/components/termix/session/file-manager-state.ts': {
					statements: 87,
					branches: 72,
					functions: 100,
					lines: 91
				}
			},
			exclude: [
				'src/**/*.d.ts',
				'src/**/*.svelte.{js,ts}',
				'src/**/*.{test,spec}.{js,ts}',
				'src/**/__tests__/**',
				'src/**/__fixtures__/**',
				'src/**/__mocks__/**',
				'src/**/fixtures/**',
				'src/**/test-helpers/**',
				'src/**/*.{fixture,fixtures,mock,mocks}.{js,ts}',
				'src/lib/assets/**',
				'src/lib/components/ui/**',
				'src/lib/server/db/migrations/**',
				'src/routes/**/+*.svelte',
				'.svelte-kit/**',
				'coverage/**',
				'drizzle/**'
			]
		}
	}
});
