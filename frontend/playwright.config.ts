import { defineConfig, devices } from '@playwright/test';

const PREVIEW = process.env['E2E_TARGET'] === 'preview';
const PORT = PREVIEW ? 4173 : 5173;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env['CI'],
	retries: process.env['CI'] ? 2 : 0,
	workers: process.env['CI'] ? 1 : undefined,
	// The html reporter's default open mode starts a server that never returns, hanging CI.
	reporter: [['list'], ['html', { open: 'never' }]],
	timeout: 90_000,
	globalSetup: './e2e/support/warm-dev-server.ts',
	expect: {
		timeout: 20_000
	},
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] }
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] }
		},
		{
			name: 'Mobile Chrome',
			use: { ...devices['Pixel 5'] }
		},
		{
			name: 'Mobile Safari',
			use: { ...devices['iPhone 12'] }
		}
	],

	webServer: {
		command: PREVIEW ? 'npm run build && npm run preview' : 'npm run dev',
		url: `http://localhost:${PORT}/`,
		// A preview server can serve a stale bundle, so it is never reused.
		reuseExistingServer: !process.env['CI'] && !PREVIEW,
		timeout: 180_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
