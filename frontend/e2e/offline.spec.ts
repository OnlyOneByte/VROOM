import { test, expect } from '@playwright/test';
import { E2E_USER, VEHICLE_CAMRY, addSessionCookie, mockApi } from './support/mock-api';

const PREVIEW = process.env['E2E_TARGET'] === 'preview';

test.describe('Offline expense entry', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('an expense saved offline shows on the list, and Add Expense opens again with the cached vehicles', async ({
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
		await expect(page.getByText(`${VEHICLE_CAMRY.year} Toyota Camry`)).toBeVisible();
		await expect(page.getByText("Couldn't load your vehicles")).toHaveCount(0);
	});

	test('an entry the server rejected can be edited and synced instead of discarded', async ({
		page,
		context
	}) => {
		const rejected = {
			id: 'offline_1_rejected',
			clientId: 'client-rejected',
			vehicleId: VEHICLE_CAMRY.id,
			tags: [],
			category: 'misc',
			amount: 1_000_001,
			date: '2026-01-05T12:00:00.000Z',
			description: 'Bridge toll',
			timestamp: 1,
			synced: false,
			version: '3.0',
			needsAttention: true,
			attentionReason: 'Amount must be 1,000,000 or less'
		};
		await context.addInitScript(
			([key, row]) => {
				if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([row]));
			},
			[`vroom_offline_expenses:${E2E_USER.id}`, rejected] as const
		);

		await page.goto('/expenses');
		await expect(
			page.getByText("The server didn't accept this entry: Amount must be 1,000,000 or less")
		).toBeVisible();
		await page.mouse.move(1000, 400);
		await page.getByRole('link', { name: /^Edit .*1,000,001/ }).click();

		await expect(page.getByRole('heading', { name: 'Edit Queued Expense' })).toBeVisible();
		await expect(page.getByLabel('Amount *')).toHaveValue('1000001');
		await page.getByRole('button', { name: 'Save Expense' }).click();
		await expect(page.locator('#amount-error')).toHaveText('Amount must be 1,000,000 or less');

		await page.getByLabel('Amount *').fill('6.50');
		await page.getByRole('button', { name: 'Save Expense' }).click();
		await expect(page.getByText('Entry updated. Syncing it now.')).toBeVisible();
		await expect(page).toHaveURL(/\/expenses$/);
		await expect(page.getByText(/Needs attention \(/)).toHaveCount(0);
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

	test('Add Expense lists the vehicles offline even if it was never opened online', async ({
		page,
		context
	}) => {
		await page.goto('/dashboard');
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.reload();
		await expect(page.getByText(`${VEHICLE_CAMRY.year} Toyota Camry`).first()).toBeVisible();

		await context.route('**/api/v1/**', route => route.abort('internetdisconnected'));
		await context.setOffline(true);

		const coldStart = await context.newPage();
		await coldStart.goto('/expenses/new');
		await expect(coldStart.getByRole('heading', { name: 'Add Expense' })).toBeVisible();
		await expect(coldStart.getByText(`${VEHICLE_CAMRY.year} Toyota Camry`)).toBeVisible();
		await expect(coldStart.getByText("Couldn't load your vehicles")).toHaveCount(0);
	});
});
