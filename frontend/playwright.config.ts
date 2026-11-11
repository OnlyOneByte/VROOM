import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the VROOM E2E suite.
 *
 * TWO SERVER TARGETS, selected by `E2E_TARGET`:
 *
 *   unset (default) — `vite dev` on 5173. Chosen as the default on its merits: it skips the
 *     ~17s production build, it recompiles from source so a reused server can never serve a
 *     stale bundle (hence `reuseExistingServer`), and because every `/api/v1` call is mocked
 *     in-browser it needs neither the backend nor a database. Its one real gap is the PWA
 *     surface: `SvelteKitPWA` is configured with no `devOptions`, so `vite dev` serves no
 *     service worker and no web app manifest.
 *
 *   `E2E_TARGET=preview` — `vite build && vite preview` on 4173, the bundle that actually
 *     ships. This is the only target that serves the real service worker and manifest, so
 *     the three PWA tests that need them run HERE and skip on dev (see pwa.spec.ts).
 *     Run it with `E2E_TARGET=preview npx playwright test`.
 *
 * Both targets are green. Earlier revisions of this file claimed `npm run build` was broken
 * in `@vite-pwa/sveltekit`; that was a dangling import from an unrelated change, and the
 * build has since exited 0. What actually used to hang this config was `webServer.port: 5173`
 * against a `vite preview` that binds 4173.
 *
 * ONE HAZARD TO KNOW ABOUT on the dev target: anything that runs `svelte-kit sync` — a
 * concurrent `npm run check`, `vitest`, or another editor on the same checkout — rewrites
 * `.svelte-kit/generated/`, and `vite dev` answers by force-reloading every page it is
 * serving. That aborts in-flight navigations ("Execution context was destroyed",
 * `NS_ERROR_ABORT`), which no timeout can absorb. Do not run those alongside the suite; or
 * use the preview target, which has no HMR and is immune. It is NOT worker oversubscription
 * — capping `workers` does not help, so this config does not pretend it does.
 *
 * See e2e/README.md.
 */
const PREVIEW = process.env['E2E_TARGET'] === 'preview';
const PORT = PREVIEW ? 4173 : 5173;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env['CI'],
	// Zero locally, on purpose: a retry here would hide a flake from the only person able to
	// reproduce and fix it. CI retries because a red shared pipeline blocks everyone.
	retries: process.env['CI'] ? 2 : 0,
	workers: process.env['CI'] ? 1 : undefined,
	// `open: 'never'`: the default ('on-failure') hands the terminal to a report web server
	// and never returns, so a failing run hangs CI and any non-interactive caller. `list` is
	// already the default local reporter; it is named so adding `html` does not drop it.
	reporter: [['list'], ['html', { open: 'never' }]],
	// 90s, up from Playwright's 30s default. On the dev target a test that triggers a route
	// re-compile needs room for several slow assertions, not just one.
	timeout: 90_000,
	// `globalSetup` pre-compiles every route the specs visit (see support/warm-dev-server.ts),
	// so no test is charged the one-time ~18s cold-compile cost.
	globalSetup: './e2e/support/warm-dev-server.ts',
	expect: {
		// 20s, up from Playwright's 5s default. Warming removes the cold-compile cost in the
		// normal case, but a route still re-transforms whenever anything it imports changes on
		// disk, and `svelte-kit sync` rewriting `.svelte-kit/generated/` is enough to trigger
		// that. At 5s those re-compiles surface as "expected heading, saw the loading shell" —
		// a red run that says nothing about the app. Kept well under the test timeout so a
		// genuine hang fails on the assertion that is actually stuck.
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
		// Mobile testing
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
		// `url` (not `port`) so the wait is on the app actually answering a request, not just
		// on something holding the TCP port — a dev server binds the port well before it can
		// serve the first SSR render.
		url: `http://localhost:${PORT}/`,
		// A dev server always reads current source, so a reused one cannot serve a stale
		// bundle. A preview server can, so it is never reused.
		reuseExistingServer: !process.env['CI'] && !PREVIEW,
		// Cold start is a dependency re-optimization plus the first SSR compile; on the
		// preview target it is a full production build.
		timeout: 180_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
