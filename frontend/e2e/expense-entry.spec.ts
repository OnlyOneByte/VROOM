import { test, expect, type Page } from '@playwright/test';
import { E2E_USER, VEHICLE_CAMRY, addSessionCookie, mockApi } from './support/mock-api';

const NEXT_ODOMETER = '46000';

test.describe('Expense form', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('renders the required fields', async ({ page }) => {
		await page.goto('/expenses/new');

		await expect(page.getByRole('heading', { name: 'New expense' })).toBeVisible();
		await expect(page.getByText('Category *', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Amount *')).toBeVisible();
		await expect(page.getByLabel('Date *')).toHaveText(/Today/);
		await expect(page.getByLabel('Vehicle *')).toHaveText(VEHICLE_CAMRY.nickname);
		await expect(page.getByLabel('Amount *')).toBeFocused();

		for (const category of [
			'Fuel',
			'Maintenance',
			'Financial',
			'Regulatory',
			'Enhancement',
			'Misc'
		]) {
			await expect(page.getByRole('radio', { name: category })).toBeVisible();
		}
	});

	test('submitting an empty form reports the missing fields and posts nothing', async ({
		page
	}) => {
		let posted = false;
		await page.route(
			url => url.pathname === '/api/v1/expenses',
			async route => {
				if (route.request().method() === 'POST') posted = true;
				await route.fallback();
			}
		);

		await page.goto('/expenses/new');
		await page.getByRole('button', { name: 'Save expense' }).click();

		await expect(page.getByText('Please select a category')).toBeVisible();
		await expect(page.getByText('Amount must be greater than 0')).toBeVisible();
		expect(posted).toBe(false);
	});

	test('fuel fields appear only for the fuel category', async ({ page }) => {
		await page.goto('/expenses/new');

		await expect(page.getByLabel('Gallons (US) *')).toBeHidden();

		await page.getByRole('radio', { name: 'Fuel' }).click();

		await expect(page.getByLabel('Gallons (US) *')).toBeVisible();
		await expect(page.getByLabel('Odometer *')).toBeVisible();

		await page.getByRole('radio', { name: 'Maintenance' }).click();
		await expect(page.getByLabel('Gallons (US) *')).toBeHidden();
	});

	test('the categories are one radio group: one tab stop, arrows move, Space selects', async ({
		page
	}) => {
		await page.goto('/expenses/new');
		const group = page.getByRole('radiogroup', { name: 'Category *' });
		await expect(group.getByRole('radio')).toHaveCount(6);

		await page.getByLabel('Amount *').fill('30');
		await page.getByTestId('receipt-scan-button').focus();
		await page.keyboard.press('Tab');
		await expect(group.getByRole('radio', { name: 'Fuel' })).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(group.getByRole('radio', { name: 'Maintenance' })).toBeFocused();
		await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);

		await page.keyboard.press('Space');
		await expect(group.getByRole('radio', { name: 'Maintenance' })).toBeChecked();
		await page.keyboard.press('ArrowRight');
		await expect(group.getByRole('radio', { name: 'Financial' })).toBeChecked();
		await expect(page.getByLabel('Gallons (US) *')).toBeHidden();

		await page.keyboard.press('Tab');
		await expect(group.getByRole('radio', { name: 'Financial' })).not.toBeFocused();
	});

	test('a fuel expense POSTs the backend field names and confirms', async ({ page }) => {
		await page.goto('/expenses/new');

		await page.getByRole('radio', { name: 'Fuel' }).click();
		await page.getByLabel('Amount *').fill('45.50');
		await page.getByLabel('Gallons (US) *').fill('12.5');
		await page.getByLabel('Odometer *').fill(NEXT_ODOMETER);

		const postRequest = page.waitForRequest(
			request =>
				new URL(request.url()).pathname === '/api/v1/expenses' && request.method() === 'POST'
		);
		await page.getByRole('button', { name: 'Save expense' }).click();

		expect((await postRequest).postDataJSON()).toMatchObject({
			vehicleId: VEHICLE_CAMRY.id,
			category: 'fuel',
			expenseAmount: 45.5,
			volume: 12.5,
			mileage: 46000
		});

		await expect(page.getByText(/^Saved \$45\.50 for /)).toBeVisible();
		await expect(page).toHaveURL(/\/expenses$/);
	});

	test('an expense logged while offline is queued, then drained to the server', async ({
		page
	}) => {
		const posted: Array<Record<string, unknown>> = [];
		await page.route(
			url => url.pathname === '/api/v1/expenses',
			async route => {
				if (route.request().method() === 'POST') {
					posted.push(route.request().postDataJSON() as Record<string, unknown>);
				}
				await route.fallback();
			}
		);

		await page.goto('/expenses/new');

		await page.getByRole('radio', { name: 'Maintenance' }).click();
		await page.getByLabel('Amount *').fill('25');

		await expect(async () => {
			await page.evaluate(() => window.dispatchEvent(new Event('offline')));
			await expect(page.getByText('Offline mode - will sync when online')).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 20_000 });

		await page.getByRole('button', { name: 'Save expense' }).click();

		await expect(page.getByText('Expense saved offline. Will sync when online.')).toBeVisible();

		const readOutbox = () =>
			page.evaluate(
				userId =>
					JSON.parse(localStorage.getItem(`vroom_offline_expenses:${userId}`) ?? '[]') as Array<
						Record<string, unknown>
					>,
				E2E_USER.id
			);

		const queued = await readOutbox();
		expect(queued).toHaveLength(1);
		expect(queued[0]).toMatchObject({ category: 'maintenance', amount: 25, synced: false });
		expect(posted).toEqual([]);

		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await page.getByRole('button', { name: /^Sync status:/ }).click();
		const syncButton = page
			.getByRole('dialog', { name: 'Sync status' })
			.getByRole('button', { name: 'Sync Now' });
		await expect(syncButton).toBeVisible();

		await syncButton.click();

		await expect(async () => {
			expect(posted.length).toBeGreaterThan(0);
		}).toPass();
		expect(posted[0]).toMatchObject({
			vehicleId: VEHICLE_CAMRY.id,
			category: 'maintenance',
			expenseAmount: 25
		});
		const clientIds = new Set(posted.map(body => body['clientId']));
		expect(clientIds.size).toBe(1);
		expect([...clientIds][0]).toBeTruthy();

		await expect(async () => {
			expect(await readOutbox()).toEqual([]);
		}).toPass();
	});

	test('a non-increasing odometer reading is rejected', async ({ page }) => {
		await page.goto('/expenses/new');

		await page.getByRole('radio', { name: 'Fuel' }).click();
		await page.getByLabel('Amount *').fill('40');
		await page.getByLabel('Gallons (US) *').fill('10');
		await page.getByLabel('Odometer *').fill('44000');

		await page.getByRole('button', { name: 'Save expense' }).click();

		await expect(page.getByText(/Mileage must be greater than 45,000/)).toBeVisible();
	});
});

test.describe('Expense list', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	const visibleText = (page: Page, text: string) =>
		page.getByText(text).filter({ visible: true }).first();

	test('lists the stored expenses with their amounts', async ({ page }) => {
		await page.goto('/expenses');

		await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();
		await expect(visibleText(page, '$45.50')).toBeVisible();
		await expect(visibleText(page, '$89.99')).toBeVisible();
		await expect(visibleText(page, 'Maintenance')).toBeVisible();
	});

	test('both layouts lead the row with the description', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/expenses');
		await expect(visibleText(page, 'Oil change')).toBeVisible();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(visibleText(page, 'Oil change')).toBeVisible();
		await expect(visibleText(page, '$89.99')).toBeVisible();
	});

	test('searching re-queries the server instead of filtering in the browser', async ({ page }) => {
		await page.goto('/expenses');
		await expect(visibleText(page, '$89.99')).toBeVisible();

		const filtered = page.waitForRequest(request => {
			const url = new URL(request.url());
			return url.pathname === '/api/v1/expenses' && url.searchParams.get('search') === 'oil';
		});

		await page.getByRole('textbox', { name: /^Search expenses/i }).fill('oil');

		await filtered;
	});

	test('a category filter re-queries the server with that category', async ({ page }) => {
		await page.goto('/expenses');
		await expect(visibleText(page, '$89.99')).toBeVisible();

		const filtered = page.waitForRequest(request => {
			const url = new URL(request.url());
			return (
				url.pathname === '/api/v1/expenses' && url.searchParams.get('category') === 'maintenance'
			);
		});

		await page.getByRole('button', { name: /^Filters/ }).click();
		await page
			.getByRole('dialog', { name: 'Filters' })
			.getByRole('button', { name: 'Maintenance' })
			.click();

		await filtered;
	});

	async function deleteFirstExpense(page: Page, failWith?: number) {
		await page.setViewportSize({ width: 1280, height: 800 });
		const deleted: string[] = [];
		await page.route(
			url => /^\/api\/v1\/expenses\/[^/]+$/.test(url.pathname),
			async route => {
				if (route.request().method() !== 'DELETE') return route.fallback();
				deleted.push(new URL(route.request().url()).pathname);
				if (!failWith) return route.fallback();
				return route.fulfill({
					status: failWith,
					json: { success: false, message: 'Database unavailable' }
				});
			}
		);

		await page.goto('/expenses');
		await expect(visibleText(page, '$89.99')).toBeVisible();
		const first = page.getByTestId('expense-row').first();
		await first.getByRole('button', { name: /Costco fill-up|Oil change/ }).click();
		await first.getByRole('button', { name: 'Delete', exact: true }).click();

		const dialog = page.getByRole('alertdialog', { name: 'Delete expense?' });
		await expect(dialog.getByText(/You can undo it for 5 seconds\./)).toBeVisible();
		const described = await dialog.getByText(/Costco fill-up|Oil change/).textContent();
		await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

		const fuel = described?.includes('Costco fill-up') ?? false;
		const name = fuel ? 'Costco fill-up' : 'Oil change';
		const row = page.getByTestId('expense-row').filter({ hasText: name });
		const id = fuel ? 'expense-fuel' : 'expense-maint';
		return { deleted, row, path: `/api/v1/expenses/${id}` };
	}

	test('a deleted row goes at once, and Undo brings it back with no DELETE sent', async ({
		page
	}) => {
		const { deleted, row } = await deleteFirstExpense(page);

		await expect(row).toHaveCount(0);
		await page.getByRole('button', { name: 'Undo' }).click();
		await expect(row).toHaveCount(1);

		await page.waitForTimeout(6000);
		expect(deleted).toEqual([]);
		await expect(row).toHaveCount(1);
	});

	test('without Undo the DELETE goes out once the 5 s are up', async ({ page }) => {
		const { deleted, row, path } = await deleteFirstExpense(page);

		await expect(row).toHaveCount(0);
		expect(deleted).toEqual([]);
		await expect.poll(() => deleted, { timeout: 10_000 }).toEqual([path]);
		await expect(row).toHaveCount(0);
	});

	test('a failed DELETE brings the row back with its error and Retry', async ({ page }) => {
		const { deleted, row, path } = await deleteFirstExpense(page, 500);

		await expect.poll(() => deleted, { timeout: 10_000 }).toEqual([path]);
		await expect(row).toHaveCount(1);
		await expect(row.getByText(/^Not deleted:/)).toBeVisible();

		await row.getByRole('button', { name: /^Retry deleting/ }).click();
		await expect.poll(() => deleted.length).toBe(2);
	});
});

test.describe('Mobile expense entry', () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('the form fits the viewport with no horizontal scroll', async ({ page }) => {
		await page.goto('/expenses/new');
		await expect(page.getByLabel('Amount *')).toBeVisible();

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});

	test('numeric fields open a numeric keypad and clear the WCAG target-size minimum', async ({
		page
	}) => {
		await page.goto('/expenses/new');

		const amount = page.getByLabel('Amount *');
		await expect(amount).toHaveAttribute('type', /number|tel|decimal/);

		const box = await amount.boundingBox();
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
	});

	test('the primary action is a full-size touch target', async ({ page }) => {
		await page.goto('/expenses/new');

		const save = page.getByRole('button', { name: 'Save expense' });
		const box = await save.boundingBox();
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
	});
});
