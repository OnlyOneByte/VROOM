import { chromium, type FullConfig } from '@playwright/test';
import { SESSION_COOKIE, mockApi } from './mock-api';

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
	const failures = new Map<string, string>();

	try {
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage();

			await page.context().addCookies([SESSION_COOKIE]);
			await mockApi(page);

			for (const route of ROUTES) {
				try {
					await page.goto(`${baseURL}${route}`, { waitUntil: 'commit', timeout: 120_000 });
					warmed.add(route);
				} catch (error) {
					failures.set(route, error instanceof Error ? error.message : String(error));
				}
			}
		} finally {
			await browser.close();
		}
	} catch (error) {
		console.log(`[e2e] warming skipped: ${error instanceof Error ? error.message : error}`);
	}

	const seconds = ((Date.now() - started) / 1000).toFixed(1);
	const unwarmed = ROUTES.filter(route => !warmed.has(route)).map(
		route => `${route}: ${failures.get(route) ?? 'not attempted'}`
	);
	console.log(
		`[e2e] warmed ${warmed.size}/${ROUTES.length} routes in ${seconds}s` +
			(unwarmed.length ? ` (un-warmed: ${unwarmed.join('; ')})` : '')
	);
}
