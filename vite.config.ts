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
			include: ['src/**/*.{js,ts}'],
			thresholds: {
				statements: 60,
				branches: 55,
				functions: 58,
				lines: 63
			},
			exclude: [
				'src/**/*.d.ts',
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
