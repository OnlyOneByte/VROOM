import { test, expect } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

const PREVIEW = process.env['E2E_TARGET'] === 'preview';

test.describe('Opening the app offline', () => {
	test.skip(!PREVIEW, 'needs the service worker; run with E2E_TARGET=preview');

	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('a visited page reloads offline, and an unvisited one shows the offline page', async ({
		page,
		context
	}) => {
		await page.goto('/dashboard');
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.reload();
		await page.goto('/expenses');
		await expect(page.getByRole('heading', { name: 'All Expenses' })).toBeVisible();

		await page.route('**/api/v1/**', route => route.abort('internetdisconnected'));
		await context.setOffline(true);

		await page.reload();
		await expect(page.getByRole('heading', { name: 'All Expenses' })).toBeVisible();

		await page.goto('/trips');
		await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute(
			'href',
			'/dashboard'
		);
	});
});
