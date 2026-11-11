import { test, expect, type Page } from '@playwright/test';
import { VEHICLE_CAMRY, addSessionCookie, mockApi } from './support/mock-api';

// Logging an expense at /expenses/new. Category is a button grid, not a <select>.

// Must exceed the vehicle's starting mileage and the latest fill-up; readings must increase.
const NEXT_ODOMETER = '46000';

test.describe('Expense form', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('renders the required fields', async ({ page }) => {
		await page.goto('/expenses/new');

		await expect(page.getByRole('heading', { name: 'Add Expense' })).toBeVisible();
		await expect(page.getByText('Category *', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Amount *')).toBeVisible();
		await expect(page.getByText('Date *', { exact: true })).toBeVisible();
		await expect(page.getByText(`${VEHICLE_CAMRY.year} Toyota Camry`)).toBeVisible();

		// There is no insurance category; insurance is logged under Financial.
		for (const category of [
			'Fuel',
			'Maintenance',
			'Financial',
			'Regulatory',
			'Enhancement',
			'Misc'
		]) {
			await expect(page.getByRole('button', { name: new RegExp(`^${category}`) })).toBeVisible();
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
		await page.getByRole('button', { name: 'Save Expense' }).click();

		await expect(page.getByText('Please select a category')).toBeVisible();
		await expect(page.getByText('Amount must be greater than 0')).toBeVisible();
		expect(posted).toBe(false);
	});

	test('fuel fields appear only for the fuel category', async ({ page }) => {
		await page.goto('/expenses/new');

		await expect(page.getByLabel('Gallons (US) *')).toBeHidden();

		await page.getByRole('button', { name: /^Fuel/ }).click();

		await expect(page.getByLabel('Gallons (US) *')).toBeVisible();
		await expect(page.getByLabel('Current Mileage *')).toBeVisible();

		await page.getByRole('button', { name: /^Maintenance/ }).click();
		await expect(page.getByLabel('Gallons (US) *')).toBeHidden();
	});

	test('a fuel expense POSTs the backend field names and confirms', async ({ page }) => {
		await page.goto('/expenses/new');

		await page.getByRole('button', { name: /^Fuel/ }).click();
		await page.getByLabel('Amount *').fill('45.50');
		await page.getByLabel('Gallons (US) *').fill('12.5');
		await page.getByLabel('Current Mileage *').fill(NEXT_ODOMETER);

		const postRequest = page.waitForRequest(
			request =>
				new URL(request.url()).pathname === '/api/v1/expenses' && request.method() === 'POST'
		);
		await page.getByRole('button', { name: 'Save Expense' }).click();

		// The wire field is expenseAmount, not amount.
		expect((await postRequest).postDataJSON()).toMatchObject({
			vehicleId: VEHICLE_CAMRY.id,
			category: 'fuel',
			expenseAmount: 45.5,
			volume: 12.5,
			mileage: 46000
		});

		await expect(page.getByText('Expense added successfully')).toBeVisible();
		await expect(page).toHaveURL(/\/expenses$/);
	});

	test('an expense logged while offline is queued, then drained to the server', async ({
		page
	}) => {
		// Follows the row to the wire, since the drain is where data safety is at stake.
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

		await page.getByRole('button', { name: /^Maintenance/ }).click();
		await page.getByLabel('Amount *').fill('25');

		// The form branches on the offline store. Confirm the listener is attached before
		// submitting, or the online branch runs and the test measures nothing.
		await expect(async () => {
			await page.evaluate(() => window.dispatchEvent(new Event('offline')));
			await expect(page.getByText('Offline mode - will sync when online')).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 20_000 });

		await page.getByRole('button', { name: 'Save Expense' }).click();

		await expect(page.getByText('Expense saved offline. Will sync when online.')).toBeVisible();

		const readOutbox = () =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem('vroom_offline_expenses') ?? '[]') as Array<
						Record<string, unknown>
					>
			);

		const queued = await readOutbox();
		expect(queued).toHaveLength(1);
		expect(queued[0]).toMatchObject({ category: 'maintenance', amount: 25, synced: false });
		// Nothing reached the server while offline; the row exists only in the outbox.
		expect(posted).toEqual([]);

		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		const syncButton = page.getByRole('button', { name: /Sync 1/ });
		await expect(syncButton).toBeVisible();

		// Either the click or the delayed auto-sync may drain first, so assert the end state, not the POST count.
		await syncButton.click();

		// Sent through the same transformer as the online path.
		await expect(async () => {
			expect(posted.length).toBeGreaterThan(0);
		}).toPass();
		expect(posted[0]).toMatchObject({
			vehicleId: VEHICLE_CAMRY.id,
			category: 'maintenance',
			expenseAmount: 25
		});
		// Same idempotency key on every attempt, so duplicate drains collapse to one row.
		const clientIds = new Set(posted.map(body => body['clientId']));
		expect(clientIds.size).toBe(1);
		expect([...clientIds][0]).toBeTruthy();

		// The outbox must end empty: an unremoved row resends forever; a cleared unsent row is lost.
		await expect(async () => {
			expect(await readOutbox()).toEqual([]);
		}).toPass();
	});

	test('a non-increasing odometer reading is rejected', async ({ page }) => {
		await page.goto('/expenses/new');

		await page.getByRole('button', { name: /^Fuel/ }).click();
		await page.getByLabel('Amount *').fill('40');
		await page.getByLabel('Gallons (US) *').fill('10');
		await page.getByLabel('Current Mileage *').fill('44000');

		await page.getByRole('button', { name: 'Save Expense' }).click();

		await expect(page.getByText(/Mileage must be greater than 45,000/)).toBeVisible();
	});
});

test.describe('Expense list', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	// Only one table layout renders at a time; filter({ visible: true }) skips matches in
	// summary cards or closed Select portals.
	const visibleText = (page: Page, text: string) =>
		page.getByText(text).filter({ visible: true }).first();

	test('lists the stored expenses with their amounts', async ({ page }) => {
		await page.goto('/expenses');

		await expect(page.getByRole('heading', { name: 'All Expenses' })).toBeVisible();
		// Amount and category are rendered by both layouts; the description is wide-only.
		await expect(visibleText(page, '$45.50')).toBeVisible();
		await expect(visibleText(page, '$89.99')).toBeVisible();
		await expect(visibleText(page, 'Maintenance')).toBeVisible();
	});

	test('the wide layout carries the description, the compact row deliberately does not', async ({
		page
	}) => {
		// The mobile row omits the description, so assert both halves of the rule per viewport.
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/expenses');
		await expect(visibleText(page, 'Oil change')).toBeVisible();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(visibleText(page, 'Oil change')).toBeHidden();
		await expect(visibleText(page, '$89.99')).toBeVisible();
	});

	test('searching re-queries the server instead of filtering in the browser', async ({ page }) => {
		await page.goto('/expenses');
		await expect(visibleText(page, '$89.99')).toBeVisible();

		const filtered = page.waitForRequest(request => {
			const url = new URL(request.url());
			return url.pathname === '/api/v1/expenses' && url.searchParams.get('search') === 'oil';
		});

		// Page-level search, which exists in both layouts. Matched by prefix so the label can change.
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

		// Narrows across all pages server-side, unlike hiding rows already rendered.
		await page.getByRole('button', { name: /Category/ }).click();
		await page.getByRole('option', { name: 'Maintenance' }).click();

		await filtered;
	});

	test('deleting an expense confirms first, then DELETEs that row', async ({ page }) => {
		// The per-row Delete only exists in the wide layout.
		await page.setViewportSize({ width: 1280, height: 800 });

		const deleted: string[] = [];
		await page.route(
			url => /^\/api\/v1\/expenses\/[^/]+$/.test(url.pathname),
			async route => {
				if (route.request().method() === 'DELETE') {
					deleted.push(new URL(route.request().url()).pathname);
				}
				await route.fallback();
			}
		);

		await page.goto('/expenses');
		await expect(visibleText(page, '$89.99')).toBeVisible();

		await page.getByRole('button', { name: 'Delete expense' }).first().click();

		// The confirmation is an AlertDialog, so its role is alertdialog.
		const dialog = page.getByRole('alertdialog', { name: 'Delete Expense' });
		await expect(dialog.getByText('This action cannot be undone.')).toBeVisible();
		// Nothing may be sent until the confirmation is accepted.
		expect(deleted).toEqual([]);

		// Read the target from the dialog rather than assuming sort order.
		const described = await dialog.getByText(/Costco fill-up|Oil change/).textContent();
		const expectedId = described?.trim() === 'Costco fill-up' ? 'expense-fuel' : 'expense-maint';

		await dialog.getByRole('button', { name: 'Delete' }).click();

		await expect(page.getByText('Expense deleted successfully')).toBeVisible();
		expect(deleted).toEqual([`/api/v1/expenses/${expectedId}`]);
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

		// 24px is the WCAG 2.5.8 minimum target size, the bar asserted here.
		const box = await amount.boundingBox();
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
	});

	test('the primary action is a full-size touch target', async ({ page }) => {
		await page.goto('/expenses/new');

		const save = page.getByRole('button', { name: 'Save Expense' });
		const box = await save.boundingBox();
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
	});
});
