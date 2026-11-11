import { test, expect, type Page } from '@playwright/test';
import { VEHICLE_CAMRY, addSessionCookie, mockApi } from './support/mock-api';

/**
 * Logging an expense, and seeing it in the list.
 *
 * The expense form is at `/expenses/new` (the previous version of this file navigated to
 * `/vehicles/<id>/expenses/new`, which is not a route) and the API is `/api/v1/expenses`.
 * Category is a button grid, not a `<select>`, so there is no `selectOption` here.
 */

/** A mileage above both the vehicle's initial mileage and the latest fixture fill-up —
 *  the form rejects a reading that is not strictly increasing. */
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
		// The vehicle picker defaults to the first vehicle.
		await expect(page.getByText(`${VEHICLE_CAMRY.year} Toyota Camry`)).toBeVisible();

		// The picker offers every expense category. Note there is no `insurance` card —
		// insurance is logged under Financial — so a spec looking for one is asserting a
		// taxonomy the app does not have.
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

		// Switching to a non-fuel category withdraws them again.
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

		// `amount` is renamed to `expenseAmount` on the wire — assert the real contract.
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
		// Every POST body the app sends to the create endpoint, in order. The drain is the
		// point data safety is actually at stake, so the test follows the row all the way to
		// the wire instead of stopping at the "Sync 1" affordance.
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

		// The form branches on the offline STORE, which flips on the window `offline`
		// event — dispatching it drives the real code path on every engine. Confirm it
		// landed (the listener is registered during hydration) before submitting, or the
		// form takes the ONLINE branch and the test measures nothing.
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
		// Nothing reached the server while offline — the row exists ONLY in the outbox.
		expect(posted).toEqual([]);

		// Back online, the queue surfaces a sync affordance rather than silently sitting there.
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		const syncButton = page.getByRole('button', { name: /Sync 1/ });
		await expect(syncButton).toBeVisible();

		// Clicking it drains immediately. Reconnecting ALSO arms `syncManager`'s auto-sync
		// (a 2s-delayed `syncAll`), so the assertions below deliberately do not care which
		// of the two paths got there first — only that the row reached the server and left
		// the outbox. Counting POSTs exactly would race the two.
		await syncButton.click();

		// The queued row reaches the real create endpoint, renamed to the backend's field
		// names by the same transformer the online path uses.
		await expect(async () => {
			expect(posted.length).toBeGreaterThan(0);
		}).toPass();
		expect(posted[0]).toMatchObject({
			vehicleId: VEHICLE_CAMRY.id,
			category: 'maintenance',
			expenseAmount: 25
		});
		// Every attempt carries the SAME idempotency key, so even if both drain paths fire
		// the backend collapses them onto one row instead of duplicating the expense.
		const clientIds = new Set(posted.map(body => body['clientId']));
		expect(clientIds.size).toBe(1);
		expect([...clientIds][0]).toBeTruthy();

		// And the outbox ends EMPTY. A drain that POSTs but leaves the row queued would
		// re-send it forever; one that clears without POSTing loses the expense outright.
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

	// `ExpensesTable` picks ONE layout at runtime (`{:else if isMobile.current}`), so the
	// other is absent rather than hidden. `filter({ visible: true })` is still the right
	// matcher: the same figure can also sit in the page's summary card or in a closed
	// `Select` portal, and this pins the assertion to what a user can actually see.
	const visibleText = (page: Page, text: string) =>
		page.getByText(text).filter({ visible: true }).first();

	test('lists the stored expenses with their amounts', async ({ page }) => {
		await page.goto('/expenses');

		await expect(page.getByRole('heading', { name: 'All Expenses' })).toBeVisible();
		// Amount and category label are the fields BOTH layouts render, so they are what a
		// viewport-agnostic test can assert. The description is wide-viewport only — see the
		// next test.
		await expect(visibleText(page, '$45.50')).toBeVisible();
		await expect(visibleText(page, '$89.99')).toBeVisible();
		await expect(visibleText(page, 'Maintenance')).toBeVisible();
	});

	test('the wide layout carries the description, the compact row deliberately does not', async ({
		page
	}) => {
		// The mobile row is a deliberately compact summary: category, amount, date, vehicle.
		// Asserting the description without pinning the viewport passes on three projects and
		// fails on the two mobile ones, which says nothing about the app — so assert both
		// halves of the actual rule instead.
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/expenses');
		await expect(visibleText(page, 'Oil change')).toBeVisible();

		await page.setViewportSize({ width: 375, height: 667 });
		await expect(visibleText(page, 'Oil change')).toBeHidden();
		// Still the same expense, just rendered compactly.
		await expect(visibleText(page, '$89.99')).toBeVisible();
	});

	test('searching re-queries the server instead of filtering in the browser', async ({ page }) => {
		await page.goto('/expenses');
		await expect(visibleText(page, '$89.99')).toBeVisible();

		const filtered = page.waitForRequest(request => {
			const url = new URL(request.url());
			return url.pathname === '/api/v1/expenses' && url.searchParams.get('search') === 'oil';
		});

		// The page-level search box, not the table's own control: the table's controls differ
		// between the compact and wide layouts, this input does not. Matched on a prefix because
		// the accessible name is whatever labels the input — a placeholder today, an explicit
		// `aria-label` the moment someone gives it one — and this test is about the request it
		// issues, not about its wording.
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

		// The category control is the table's own `Select` (one per layout, and only the
		// layout in use is in the DOM). Like search it narrows across ALL pages server-side
		// rather than hiding rows already rendered.
		await page.getByRole('button', { name: /Category/ }).click();
		await page.getByRole('option', { name: 'Maintenance' }).click();

		await filtered;
	});

	test('deleting an expense confirms first, then DELETEs that row', async ({ page }) => {
		// Wide viewport: the per-row Delete lives in the desktop layout's action cluster.
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

		// The wide layout's row action is an icon button named by its `title`.
		await page.getByRole('button', { name: 'Delete expense' }).first().click();

		// `alertdialog`, not `dialog`: the confirmation is a shadcn/bits-ui AlertDialog.
		const dialog = page.getByRole('alertdialog', { name: 'Delete Expense' });
		await expect(dialog.getByText('This action cannot be undone.')).toBeVisible();
		// Confirmation is not decoration: nothing may be sent until it is accepted.
		expect(deleted).toEqual([]);

		// The dialog names the row it is about to delete. Reading the target from it, rather
		// than assuming the table's sort order, keeps the id assertion below exact.
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

		// WCAG 2.2 SC 2.5.8 (Target Size, Minimum) is 24x24 CSS px. The design system's
		// Input is h-9 (36px) — comfortably over that, but under the 44px Apple HIG figure
		// this project has not adopted, so 24 is the bar asserted here.
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
