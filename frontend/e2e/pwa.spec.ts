import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { scanA11y } from './support/axe';
import { addSessionCookie, mockApi } from './support/mock-api';
import { THEME_REGISTRY, DEFAULT_THEME_ID } from '../src/lib/theme/theme-registry';

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

		expect(cachedAssets).not.toBeNull();
		expect(cachedAssets!.some(path => path.endsWith('.js'))).toBe(true);
	});

	test('declares the install meta tags exactly once', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
		const viewport = page.locator('meta[name="viewport"]');
		await expect(viewport).toHaveCount(1);
		await expect(viewport).toHaveAttribute('content', /width=device-width/);
		await expect(viewport).toHaveAttribute('content', /viewport-fit=cover/);
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
	});

	test('shows the offline badge when the browser goes offline', async ({ page }) => {
		await page.goto('/');

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
		await expect(page.getByRole('link', { name: 'Expenses', exact: true })).toBeVisible();
	});
});

interface A11yRoute {
	debt: string[];
	anonymous?: true;
	ready: (page: Page) => Locator;
}

const signInControl = (page: Page) =>
	page.getByRole('button', { name: /Sign In|Continue with/i }).first();
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
			await expect(ready(page)).toBeVisible();

			await expectNoNewViolations(page, testInfo, attachmentLabel(route), debt);

			await expect(page).toHaveURL(route);
		});
	}
});

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
			await expect(page.locator('html')).toHaveAttribute('data-theme', themeId);
			await expect(page.locator('html')).toHaveClass(/dark/);

			await expectNoNewViolations(page, testInfo, `dashboard-dark-${themeId}`, []);
		});
	}
});
