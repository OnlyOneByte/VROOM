import { chromium, type FullConfig } from '@playwright/test';
import { SESSION_COOKIE, mockApi } from './mock-api';

/**
 * Compile every route the suite visits, once, before any test runs.
 *
 * `vite dev` transforms a route's module graph the first time it is requested, and the
 * FIRST route of a cold server also pays dependency optimization. Measured on this app
 * that is ~18s for the first route and under 2s for every route after it. Charged to a
 * test, that one-time cost blows the per-assertion timeout and reports as a content
 * failure ("expected heading, got the app shell's loading state") — a red run that says
 * nothing about the app.
 *
 * Vite's transform cache lives in the server, not the browser, so warming with one
 * browser warms the expensive half for all five engine projects.
 *
 * Failures here are deliberately NOT fatal: a route that cannot warm will fail its own
 * tests with a real, specific assertion, which is far more useful than every spec
 * collapsing behind one setup error.
 */

/** Every path a spec navigates to. Keep in sync when a spec visits somewhere new. */
const ROUTES = [
	'/',
	'/auth',
	'/dashboard',
	'/expenses',
	'/expenses/new',
	'/analytics',
	'/profile',
	'/settings',
	'/reminders',
	'/insurance',
	'/trips',
	'/vehicles/new'
];

export default async function warmDevServer(config: FullConfig) {
	const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';

	const started = Date.now();
	// Starts empty, so the "un-warmed" report is accurate even when the block below never
	// gets as far as the loop.
	const warmed = new Set<string>();
	// Keyed by route rather than a parallel list: the summary derives both the un-warmed set
	// and its reasons from here, so the two can never drift apart. A route missing from this
	// map but absent from `warmed` was never attempted, which is itself the diagnosis.
	const failures = new Map<string, string>();

	// `chromium.launch()` is INSIDE the guard, not outside it. Launching is the step most
	// likely to fail on a fresh checkout (no `npx playwright install`), and a throw here
	// escapes globalSetup — which aborts the entire run before a single test executes,
	// including the four projects that never touch chromium. Warming is an optimization;
	// it must not be able to fail the suite.
	try {
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage();

			// The same fixtures the specs use, so a route renders far enough to pull in the
			// components behind its auth gate and its loaded state — that is most of the module
			// graph. A placeholder payload would warm less AND fill the server log with the
			// stores' "Cannot read properties of null" errors, which read as app bugs.
			await page.context().addCookies([SESSION_COOKIE]);
			await mockApi(page);

			for (const route of ROUTES) {
				try {
					// `commit` is the point the server has finished transforming and responded;
					// waiting for `load` would also wait on fonts and images, which are not what
					// is being warmed.
					await page.goto(`${baseURL}${route}`, { waitUntil: 'commit', timeout: 120_000 });
					warmed.add(route);
				} catch (error) {
					// Named for the same reason the outer catch names its error: a degraded
					// warm-up is only actionable if the reason survives. Still non-fatal — the
					// route's own tests run and fail with their own specific assertion.
					failures.set(route, error instanceof Error ? error.message : String(error));
				}
			}
		} finally {
			await browser.close();
		}
	} catch (error) {
		// Named, not swallowed: every route stays listed as un-warmed below, and this line is
		// what distinguishes "the browser never launched" from "the server was not up yet".
		console.log(`[e2e] warming skipped: ${error instanceof Error ? error.message : error}`);
	}

	// Printed, not silent: it is the only evidence that warming actually reached the server.
	// A run where every route is listed as un-warmed means the server was not up yet, and the
	// cold-compile cost is back on the first test that touches each page.
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const unwarmed = ROUTES.filter(route => !warmed.has(route)).map(
		route => `${route}: ${failures.get(route) ?? 'not attempted'}`
	);
	console.log(
		`[e2e] warmed ${warmed.size}/${ROUTES.length} routes in ${seconds}s` +
			(unwarmed.length ? ` (un-warmed: ${unwarmed.join('; ')})` : '')
	);
}
