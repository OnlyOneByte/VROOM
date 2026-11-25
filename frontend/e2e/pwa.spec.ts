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

	test('the authenticated shell has a phone bottom bar, and More opens the rest', async ({
		page,
		context
	}) => {
		await addSessionCookie(context);
		await mockApi(page);
		await page.setViewportSize({ width: 375, height: 667 });

		await page.goto('/dashboard');

		const bar = page.getByRole('navigation', { name: 'Main' });
		await expect(bar.getByRole('link', { name: 'Log', exact: true })).toBeVisible();
		await expect(bar.getByRole('link', { name: 'Add expense' })).toBeInViewport();
		await bar.getByRole('button', { name: 'More' }).click();
		const more = page.getByRole('dialog', { name: 'More' });
		await expect(more.getByRole('link', { name: 'Insurance' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(more).toBeHidden();
	});
});

interface A11yRoute {
	debt: string[];
	anonymous?: true;
	ready: (page: Page) => Locator;
	open?: (page: Page) => Promise<void>;
}

const signInControl = (page: Page) =>
	page.getByRole('button', { name: /Sign In|Continue with/i }).first();
const pageHeading = (name: string) => (page: Page) => page.getByRole('heading', { name }).first();
const expiredPolicy = (page: Page) => page.getByText('Policy #SF-1001').first();

const A11Y_ROUTES: Record<string, A11yRoute> = {
	'/': { anonymous: true, debt: [], ready: signInControl },
	'/auth': { anonymous: true, debt: [], ready: signInControl },
	'/dashboard': { debt: [], ready: pageHeading('Dashboard') },
	'/expenses': {
		debt: [],
		ready: page => page.getByText('$45.50').filter({ visible: true }).first()
	},
	'/expenses/new': { debt: [], ready: pageHeading('Add Expense') },
	'/vehicles': { debt: [], ready: page => page.getByTestId('garage-row').first() },
	'/vehicles/new': { debt: [], ready: pageHeading('Add Vehicle') },
	'/vehicles/vehicle-camry': {
		debt: [],
		ready: page => page.getByRole('tab', { name: 'Insurance' }),
		open: async page => {
			await page.getByRole('tab', { name: 'Insurance' }).click();
			await expect(expiredPolicy(page)).toBeVisible();
		}
	},
	'/analytics': { debt: [], ready: pageHeading('Analytics Dashboard') },
	'/insurance': { debt: [], ready: expiredPolicy },
	'/reminders': { debt: [], ready: pageHeading('Reminders') },
	'/trips': { debt: [], ready: pageHeading('Trips') },
	'/settings': { debt: [], ready: pageHeading('Settings') },
	'/settings/server': { debt: [], ready: page => page.getByText('kim@example.com') },
	'/profile': { debt: [], ready: pageHeading('Profile') },
	'/no-such-page': { debt: [], ready: pageHeading('Wrong turn') }
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
	for (const [route, { debt, anonymous, ready, open }] of Object.entries(A11Y_ROUTES)) {
		test(`${route} has no axe violations beyond its recorded debt`, async ({
			page,
			context
		}, testInfo) => {
			if (!anonymous) await addSessionCookie(context);
			await mockApi(page, { authenticated: !anonymous });

			await page.goto(route);
			await expect(ready(page)).toBeVisible();
			await open?.(page);

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

	for (const mode of ['dark', 'light'] as const) {
		for (const themeId of mode === 'dark'
			? [DEFAULT_THEME_ID, ...NON_DEFAULT_THEMES]
			: NON_DEFAULT_THEMES) {
			test(`the ${themeId} theme in ${mode} mode has no axe violations`, async ({
				page,
				context
			}, testInfo) => {
				await addSessionCookie(context);
				await page.addInitScript(
					({ modeKey, idKey, id, preference }) => {
						localStorage.setItem(modeKey, preference);
						localStorage.setItem(idKey, id);
					},
					{
						modeKey: 'vroom-theme-preference',
						idKey: 'vroom-theme-id',
						id: themeId,
						preference: mode
					}
				);
				await mockApi(page);

				await page.goto('/dashboard');
				await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
				if (themeId === DEFAULT_THEME_ID) {
					await expect(page.locator('html')).not.toHaveAttribute('data-theme');
				} else {
					await expect(page.locator('html')).toHaveAttribute('data-theme', themeId);
				}
				if (mode === 'dark') {
					await expect(page.locator('html')).toHaveClass(/dark/);
				} else {
					await expect(page.locator('html')).not.toHaveClass(/dark/);
				}

				await expectNoNewViolations(page, testInfo, `dashboard-${mode}-${themeId}`, []);
			});
		}
	}
});
