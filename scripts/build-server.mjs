import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
	configFile: false,
	root,
	resolve: {
		alias: [
			{ find: '$lib', replacement: resolve(root, 'src/lib') },
			{
				find: '$env/dynamic/private',
				replacement: resolve(root, 'scripts/sveltekit-env-dynamic-private.mjs')
			}
		]
	},
	build: {
		emptyOutDir: false,
		outDir: resolve(root, 'build'),
		ssr: resolve(root, 'server.ts'),
		target: 'node24',
		rollupOptions: {
			output: {
				entryFileNames: 'server.js',
				chunkFileNames: 'server-[name]-[hash].js'
			}
		}
	}
});
