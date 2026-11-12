import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';

const apiProxy = {
	'/api': {
		target: 'http://localhost:3001',
		changeOrigin: true
	}
};

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'service-worker.ts',
			registerType: 'autoUpdate',
			injectManifest: {
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,webmanifest}']
			},
			manifest: {
				name: 'VROOM Car Tracker',
				short_name: 'VROOM',
				id: '/',
				description: 'Track your vehicle expenses and analyze costs with VROOM Car Tracker',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				background_color: '#ffffff',
				theme_color: '#1f2937',
				orientation: 'portrait-primary',
				icons: [
					{
						src: '/pwa-64x64.png',
						sizes: '64x64',
						type: 'image/png'
					},
					{
						src: '/pwa-192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png'
					},
					{
						src: '/maskable-icon-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			}
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'happy-dom',
		setupFiles: ['src/test-setup.ts'],
		globals: true,
		server: {
			deps: {
				inline: ['svelte', '@testing-library/svelte', '@testing-library/svelte-core']
			}
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			reportsDirectory: './coverage'
		},
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname,
			$app: new URL('./node_modules/@sveltejs/kit/src/runtime/app', import.meta.url).pathname,
			'$env/dynamic/public': new URL('./src/test-env-mock.ts', import.meta.url).pathname
		}
	},
	// Vitest's default conditions omit 'browser'; without it inlined svelte loads its server entry, where mount() throws.
	resolve: {
		conditions: ['browser']
	},
	server: {
		proxy: apiProxy
	},
	preview: {
		port: 4173,
		// Without strictPort a busy port silently shifts, leaving callers waiting on the pinned one.
		strictPort: true,
		proxy: apiProxy
	}
});
