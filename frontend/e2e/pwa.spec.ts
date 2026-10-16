import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

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
const PREVIEW = process.env.E2E_TARGET === 'preview';
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
 * `@axe-core/playwright` was a devDependency with no consumer; this is its only use. It is
 * a RATCHET, not a gate on today's debt: each route carries the set of WCAG rule ids it
 * currently violates, and the test fails only on a rule id that is NOT already on that
 * list. So pre-existing violations do not block anyone, a NEW class of violation does, and
 * the full violation detail is attached to the report either way.
 *
 * Shrink a list when you fix something — an id left here after the fix makes the ratchet
 * permanently looser than the app.
 */
const A11Y_DEBT: Record<string, string[]> = {
	'/': [],
	'/auth': [],
	'/dashboard': []
};

test.describe('Accessibility (axe)', () => {
	for (const [route, allowed] of Object.entries(A11Y_DEBT)) {
		test(`${route} has no axe violations beyond its recorded debt`, async ({
			page,
			context
		}, testInfo) => {
			const authenticated = route === '/dashboard';
			if (authenticated) await addSessionCookie(context);
			await mockApi(page, { authenticated });

			await page.goto(route);
			// Wait for the route's own content, not just navigation — scanning the loading
			// shell would measure nothing.
			await expect(
				authenticated
					? page.getByRole('heading', { name: 'Dashboard' })
					: page.getByRole('button', { name: /Sign In|Continue with/i }).first()
			).toBeVisible();

			const results = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				.analyze();

			await testInfo.attach(`axe${route === '/' ? '-root' : route.replace(/\//g, '-')}.json`, {
				body: JSON.stringify(results.violations, null, 2),
				contentType: 'application/json'
			});

			const found = [...new Set(results.violations.map(v => v.id))].sort();
			const unexpected = found.filter(id => !allowed.includes(id));
			expect(
				unexpected,
				`new axe violations on ${route} (full detail attached): ${JSON.stringify(
					results.violations
						.filter(v => unexpected.includes(v.id))
						.map(v => ({
							id: v.id,
							impact: v.impact,
							nodes: v.nodes.map(n => n.target)
						}))
				)}`
			).toEqual([]);
		});
	}
});
