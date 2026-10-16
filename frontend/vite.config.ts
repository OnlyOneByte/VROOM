import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';

// Same `/api` -> backend proxy for `vite dev` AND `vite preview`. One object so the two
// servers can't drift: `preview` previously had no proxy at all, so the built app it serves
// answered every `/api/v1/...` call with its own 404 — the app looked signed out and empty
// with a healthy backend running on :3001.
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
	server: {
		proxy: apiProxy
	},
	// Pinned explicitly (4173 is also vite's default) with strictPort so a port already in use
	// fails loudly instead of silently shifting to 4174 while a caller waits on 4173 forever —
	// which is exactly how playwright.config.ts used to hang (it waited on 5173).
	preview: {
		port: 4173,
		strictPort: true,
		proxy: apiProxy
	}
});
