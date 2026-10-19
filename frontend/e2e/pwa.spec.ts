import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { scanA11y } from './support/axe';
import { addSessionCookie, mockApi } from './support/mock-api';
import { THEME_REGISTRY, DEFAULT_THEME_ID } from '../src/lib/theme/theme-registry';

/**
 * App-shell smoke: the PWA surface (manifest, service worker, asset caching, meta tags),
 * the offline indicator, responsive layout, and an axe accessibility scan.
 *
 * THREE TESTS NEED THE REAL BUNDLE. `SvelteKitPWA` is configured with no `devOptions`, so
 * `vite dev` serves neither a manifest link nor a service worker, and with no service worker
 * nothing populates the Cache Storage either. Those three run only on the preview target
 * (`E2E_TARGET=preview npx playwright test`) and are skipped on the dev default — see
 * playwright.config.ts. Turning on `devOptions` would make them green against a DEV service
 * worker, a different artifact from the one that ships: green without testing the thing that
 * matters.
 */
const PREVIEW = process.env['E2E_TARGET'] === 'preview';
const needsRealBundle = () =>
	test.skip(!PREVIEW, 'needs the production bundle; run with E2E_TARGET=preview');

test.describe('PWA surface', () => {
	test.beforeEach(async ({ page }) => {
		await mockApi(page, { authenticated: false });
	});

	test('serves a valid web app manifest', async ({ page }) => {
		needsRealBundle();
		await page.goto('/');

		const manifestLink = page.locator('link[rel="manifest"]');
		await expect(manifestLink).toHaveCount(1);

		const href = await manifestLink.getAttribute('href');
		expect(href).toBeTruthy();

		const response = await page.request.get(href!);
		expect(response.ok()).toBeTruthy();

		const manifest = await response.json();
		expect(manifest.name).toBe('VROOM Car Tracker');
		expect(manifest.short_name).toBe('VROOM');
		expect(manifest.start_url).toBeTruthy();
		expect(manifest.display).toBe('standalone');
		expect(manifest.icons.length).toBeGreaterThan(0);
	});

	test('registers a service worker', async ({ page }) => {
		needsRealBundle();
		await page.goto('/');

		const registered = await page.evaluate(async () => {
			if (!('serviceWorker' in navigator)) return 'unsupported';
			const ready = navigator.serviceWorker.ready.then(r => (r ? 'ready' : 'no-registration'));
			const timeout = new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 15000));
			return Promise.race([ready, timeout]);
		});

		expect(registered).toBe('ready');
	});

	test('the service worker precaches the static assets for offline use', async ({ page }) => {
		needsRealBundle();
		await page.goto('/');

		// Wait on the registration, not a sleep: `ready` resolves once a worker is active,
		// which is the point `injectManifest`'s precache list has been written.
		const cachedAssets = await page.evaluate(async () => {
			if (!('serviceWorker' in navigator) || !('caches' in window)) return null;
			await navigator.serviceWorker.ready;
			const names = await caches.keys();
			const urls: string[] = [];
			for (const name of names) {
				const keys = await (await caches.open(name)).keys();
				urls.push(...keys.map(request => new URL(request.url).pathname));
			}
			return urls;
		});

		// Not just "some cache exists" — a non-empty Cache Storage is also what an unrelated
		// library leaves behind. The precache manifest is built from the built client assets,
		// so at least one hashed JS chunk must be in there.
		expect(cachedAssets).not.toBeNull();
		expect(cachedAssets!.some(path => path.endsWith('.js'))).toBe(true);
	});

	test('declares the install meta tags exactly once', async ({ page }) => {
		await page.goto('/');

		// app.html is the single source of truth for both; a second copy in a
		// `<svelte:head>` would land later in the document and silently win.
		await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
		const viewport = page.locator('meta[name="viewport"]');
		await expect(viewport).toHaveCount(1);
		await expect(viewport).toHaveAttribute('content', /width=device-width/);
		// viewport-fit=cover is what makes env(safe-area-inset-*) report non-zero.
		await expect(viewport).toHaveAttribute('content', /viewport-fit=cover/);
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
	});

	test('shows the offline badge when the browser goes offline', async ({ page }) => {
		await page.goto('/');

		// The store flips on the window `offline`/`online` EVENTS, not by polling
		// navigator.onLine, so dispatching the event exercises the real code path and
		// works identically on all five engines (context.setOffline support varies).
		// Re-dispatch until it takes: the listener is registered when the offline store
		// module is evaluated during hydration, and `goto` resolves before that, so a
		// single dispatch can land before anything is listening.
		const offlineBadge = page.getByText('Offline', { exact: true });
		await expect(async () => {
			await page.evaluate(() => window.dispatchEvent(new Event('offline')));
			await expect(offlineBadge).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 20_000 });

		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect(offlineBadge).toBeHidden();
	});
});

test.describe('Responsive layout', () => {
	test.beforeEach(async ({ page }) => {
		await mockApi(page, { authenticated: false });
	});

	for (const [name, viewport] of [
		['mobile', { width: 375, height: 667 }],
		['tablet', { width: 768, height: 1024 }]
	] as const) {
		test(`the landing page has no horizontal overflow on ${name}`, async ({ page }) => {
			await page.setViewportSize(viewport);
			await page.goto('/');
			await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth
			);
			expect(overflow).toBeLessThanOrEqual(1);
		});
	}

	test('the authenticated shell exposes a mobile navigation menu', async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
		await page.setViewportSize({ width: 375, height: 667 });

		await page.goto('/dashboard');

		const hamburger = page.getByRole('button', { name: 'Open navigation menu' });
		await expect(hamburger).toBeVisible();
		await hamburger.click();
		// `exact`: the dashboard also has a "View All Expenses" link.
		await expect(page.getByRole('link', { name: 'Expenses', exact: true })).toBeVisible();
	});
});

/**
 * Accessibility ratchet.
 *
 * `@axe-core/playwright` was a devDependency with no consumer; this and expenses-a11y.spec.ts
 * are its only uses. It is a RATCHET, not a gate on today's debt: each route carries the set
 * of WCAG rule ids it currently violates, and the test fails only on a rule id that is NOT
 * already on that list. So pre-existing violations do not block anyone, a NEW class of
 * violation does, and the full violation detail is attached to the report either way.
 *
 * Shrink a list when you fix something — an id left here after the fix makes the ratchet
 * permanently looser than the app.
 *
 * Every entry also says how to REACH its route and what proves it arrived, because the
 * failure mode of a route-keyed scan is silence rather than red: a route reached without a
 * session is bounced to the sign-in page, and a readiness assertion generic enough to pass
 * there leaves axe scanning /auth under this route's name, forever, with an empty allowlist
 * that reads as a clean bill of health. The URL re-check after the scan is the backstop.
 *
 * Not every route is here. The expenses table's post-interaction states live in
 * expenses-a11y.spec.ts (its controls exist only after a tap), and the remaining routes are
 * edit forms that need a fixture id. Add a page here when you add one.
 */
interface A11yRoute {
	/** WCAG rule ids this route violates today. A rule id outside this set fails the test. */
	debt: string[];
	/** Signed-out surfaces. Every other route needs the session cookie or it redirects. */
	anonymous?: true;
	/** Content only this route renders — the app shell's loading state does not count. */
	ready: (page: Page) => Locator;
}

/** Both signed-out surfaces end at the same control, under different copy. */
const signInControl = (page: Page) =>
	page.getByRole('button', { name: /Sign In|Continue with/i }).first();
/** `.first()`: this is a readiness check, not a uniqueness one — several pages repeat their
 *  own name on a card heading below the page title. */
const pageHeading = (name: string) => (page: Page) => page.getByRole('heading', { name }).first();

const A11Y_ROUTES: Record<string, A11yRoute> = {
	'/': { anonymous: true, debt: [], ready: signInControl },
	'/auth': { anonymous: true, debt: [], ready: signInControl },
	'/dashboard': { debt: [], ready: pageHeading('Dashboard') },
	'/expenses/new': { debt: [], ready: pageHeading('Add Expense') },
	'/vehicles/new': { debt: [], ready: pageHeading('Add New Vehicle') },
	'/analytics': { debt: [], ready: pageHeading('Analytics Dashboard') },
	'/insurance': { debt: [], ready: pageHeading('Insurance') },
	'/reminders': { debt: [], ready: pageHeading('Reminders') },
	'/trips': { debt: [], ready: pageHeading('Trips') },
	'/settings': { debt: [], ready: pageHeading('Settings') },
	'/profile': { debt: [], ready: pageHeading('Profile') }
};

/** `/` → `root`, `/expenses/new` → `expenses-new`: a filename-safe attachment label. */
const attachmentLabel = (route: string) => route.replace(/^\//, '').replace(/\//g, '-') || 'root';

async function expectNoNewViolations(
	page: Page,
	testInfo: TestInfo,
	label: string,
	debt: string[]
) {
	const { ids, violations } = await scanA11y(page, testInfo, label);
	const unexpected = ids.filter(id => !debt.includes(id));
	expect(
		unexpected,
		`new axe violations on ${label} (full detail attached): ${JSON.stringify(
			violations
				.filter(violation => unexpected.includes(violation.id))
				.map(violation => ({
					id: violation.id,
					impact: violation.impact,
					nodes: violation.nodes.map(node => node.target)
				}))
		)}`
	).toEqual([]);
}

test.describe('Accessibility (axe)', () => {
	for (const [route, { debt, anonymous, ready }] of Object.entries(A11Y_ROUTES)) {
		test(`${route} has no axe violations beyond its recorded debt`, async ({
			page,
			context
		}, testInfo) => {
			if (!anonymous) await addSessionCookie(context);
			await mockApi(page, { authenticated: !anonymous });

			await page.goto(route);
			// The route's own content, not the app shell's loading state — scanning the shell
			// measures nothing, and a readiness locator generic enough to match the shell (or
			// the sign-in page the auth gate redirects to) is how a route-keyed ratchet ends up
			// reporting a permanently empty allowlist for a page it never rendered.
			await expect(ready(page)).toBeVisible();

			await expectNoNewViolations(page, testInfo, attachmentLabel(route), debt);

			// LAST, deliberately. Route protection runs in an effect once `/auth/me` resolves,
			// so immediately after `goto` the URL is still the requested one whether or not the
			// app is about to bounce you; by the time axe has run, it has settled. This is the
			// backstop for the case the readiness locator cannot see: a scan that passed, on
			// some other page, recorded under this route's name.
			await expect(page).toHaveURL(route);
		});
	}
});

/**
 * The same scan under every non-default theme, in dark mode.
 *
 * A theme swaps the CSS custom properties the entire app paints from, so a palette with too
 * little contrast is a WCAG failure on every route at once — the one defect class that
 * scanning routes under the default theme cannot see. The two localStorage keys below are
 * the app's own persistence, set before the first script runs so no flash of the default
 * palette is scanned.
 *
 * `/dashboard` is the sample: cards, stat tiles, badges, charts and the nav shell, which
 * between them paint most of the token set. Chromium only — axe derives these violations
 * from computed colour, which does not differ by engine, so the other four projects would
 * pay full price for the same answer.
 */
const NON_DEFAULT_THEMES = Object.keys(THEME_REGISTRY).filter(id => id !== DEFAULT_THEME_ID);

test.describe('Accessibility (axe) — theme palettes', () => {
	test.skip(
		({ browserName }) => browserName !== 'chromium',
		'palette contrast is engine-independent'
	);

	for (const themeId of NON_DEFAULT_THEMES) {
		test(`the ${themeId} theme in dark mode has no axe violations`, async ({
			page,
			context
		}, testInfo) => {
			await addSessionCookie(context);
			await page.addInitScript(
				({ modeKey, idKey, id }) => {
					localStorage.setItem(modeKey, 'dark');
					localStorage.setItem(idKey, id);
				},
				{ modeKey: 'vroom-theme-preference', idKey: 'vroom-theme-id', id: themeId }
			);
			await mockApi(page);

			await page.goto('/dashboard');
			await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
			// The theme actually took: both axes are applied to <html> by the store, and a
			// mis-set key would otherwise scan the default palette and pass.
			await expect(page.locator('html')).toHaveAttribute('data-theme', themeId);
			await expect(page.locator('html')).toHaveClass(/dark/);

			await expectNoNewViolations(page, testInfo, `dashboard-dark-${themeId}`, []);
		});
	}
});
