import { chromium, type FullConfig } from '@playwright/test';
import { SESSION_COOKIE, mockApi } from './mock-api';

// Pre-compiles every route before the suite: vite dev compiles lazily, and a cold first
// request can outlast a test's timeout. Failures are non-fatal; the route's own test then
// fails with a specific assertion instead.

// Keep in sync with the routes the specs visit.
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
	const warmed = new Set<string>();
	// Keyed by route so the summary's un-warmed list and reasons cannot drift apart.
	const failures = new Map<string, string>();

	// Inside the guard: a launch failure must not abort the whole run.
	try {
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage();

			// Same fixtures as the specs, so the loaded module graph gets warmed.
			await page.context().addCookies([SESSION_COOKIE]);
			await mockApi(page);

			for (const route of ROUTES) {
				try {
					// `commit`: the server has responded; `load` would also wait on fonts and images.
					await page.goto(`${baseURL}${route}`, { waitUntil: 'commit', timeout: 120_000 });
					warmed.add(route);
				} catch (error) {
					// Keeps the reason so a degraded warm-up stays actionable.
					failures.set(route, error instanceof Error ? error.message : String(error));
				}
			}
		} finally {
			await browser.close();
		}
	} catch (error) {
		// Distinguishes "browser never launched" from "server not up yet".
		console.log(`[e2e] warming skipped: ${error instanceof Error ? error.message : error}`);
	}

	// The only evidence that warming reached the server.
	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const unwarmed = ROUTES.filter(route => !warmed.has(route)).map(
		route => `${route}: ${failures.get(route) ?? 'not attempted'}`
	);
	console.log(
		`[e2e] warmed ${warmed.size}/${ROUTES.length} routes in ${seconds}s` +
			(unwarmed.length ? ` (un-warmed: ${unwarmed.join('; ')})` : '')
	);
}
