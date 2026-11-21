import { test, expect } from '@playwright/test';
import { VEHICLE_CAMRY, addSessionCookie, mockApi } from './support/mock-api';

const PREVIEW = process.env['E2E_TARGET'] === 'preview';

test.describe('Offline expense entry', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('an expense saved offline shows on the list, and Add Expense opens again', async ({
		page
	}) => {
		await page.goto('/expenses');
		await expect(page.getByRole('heading', { name: 'All Expenses' })).toBeVisible();
		await page.getByRole('link', { name: /Add Expense/ }).click();
		await expect(page.getByRole('heading', { name: 'Add Expense' })).toBeVisible();
		await expect(page.getByText(`${VEHICLE_CAMRY.year} Toyota Camry`)).toBeVisible();

		await page.route('**/api/v1/**', route => route.abort('internetdisconnected'));
		await expect(async () => {
			await page.evaluate(() => window.dispatchEvent(new Event('offline')));
			await expect(page.getByText('Offline mode - will sync when online')).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 20_000 });

		await page.getByRole('button', { name: /^Misc/ }).click();
		await page.getByLabel('Amount *').fill('12.34');
		await page.getByRole('button', { name: 'Save Expense' }).click();
		await expect(page.getByText('Expense saved offline. Will sync when online.')).toBeVisible();

		await expect(page).toHaveURL(/\/expenses$/);
		await expect(page.getByText("You're offline")).toBeVisible();
		await expect(page.getByText(/Pending Sync \(1\)/)).toBeVisible();
		await expect(page.getByText('$12.34')).toBeVisible();
		await expect(page.getByText("Couldn't load expenses")).toHaveCount(0);

		await page.getByRole('link', { name: /Add Expense/ }).click();
		await expect(page.getByRole('heading', { name: 'Add Expense' })).toBeVisible();
		await expect(page.getByText("This page couldn't load")).toHaveCount(0);
	});
});

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
