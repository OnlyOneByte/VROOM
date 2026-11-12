import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { withPwa } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const apiProxy = {
	'/api': {
		target: 'http://localhost:3001',
		changeOrigin: true
	}
};

export default defineConfig({
	plugins: [
		tailwindcss(),
		withPwa(
			{
				preprocess: vitePreprocess(),
				adapter: adapter(),
				serviceWorker: { register: false }
			},
			{
				strategies: 'buildSW',
				filename: 'service-worker.js',
				registerType: 'autoUpdate',
				buildBase: '/',
				scope: '/',
				buildSW: {
					swSrc: 'src/service-worker/index.ts',
					globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,webmanifest}'],
					// withPwa appends a prerendered/ pattern that this app never matches; strict globbing would fail the build.
					globStrict: false
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
						{ src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
						{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
						{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
						{
							src: '/maskable-icon-512x512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'maskable'
						}
					]
				}
			}
		)
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
			'$app/env/public': new URL('./src/test-env-mock.ts', import.meta.url).pathname
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
