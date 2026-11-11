import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { scanA11y } from './support/axe';
import {
	addSessionCookie,
	mockApi,
	BACKEND_EXPENSES,
	E2E_USER,
	VEHICLE_CAMRY,
	VEHICLE_CIVIC
} from './support/mock-api';

// Scans the expense table in states pwa.spec.ts cannot reach: after tapping rows or expanding
// split groups. No allowlist here; any violation fails.

const SPLIT_GROUP = [
	{
		id: 'expense-split-camry',
		vehicleId: VEHICLE_CAMRY.id,
		userId: E2E_USER.id,
		category: 'maintenance',
		expenseAmount: 150,
		date: '2024-03-12T12:00:00.000Z',
		description: 'Shared detailing',
		tags: [],
		groupId: 'group-detailing',
		groupTotal: 250,
		splitMethod: 'absolute',
		createdAt: '2024-03-12T12:00:00.000Z',
		updatedAt: '2024-03-12T12:00:00.000Z'
	},
	{
		id: 'expense-split-civic',
		vehicleId: VEHICLE_CIVIC.id,
		userId: E2E_USER.id,
		category: 'maintenance',
		expenseAmount: 100,
		date: '2024-03-12T12:00:00.000Z',
		description: 'Shared detailing',
		tags: [],
		groupId: 'group-detailing',
		groupTotal: 250,
		splitMethod: 'absolute',
		createdAt: '2024-03-12T12:00:00.000Z',
		updatedAt: '2024-03-12T12:00:00.000Z'
	}
];

// Materialized from an insurance policy, so its Delete is blocked and must explain why.
const INSURANCE_GROUP = [
	{
		id: 'expense-premium-camry',
		vehicleId: VEHICLE_CAMRY.id,
		userId: E2E_USER.id,
		category: 'financial',
		expenseAmount: 120,
		date: '2024-03-01T12:00:00.000Z',
		description: 'Policy premium',
		tags: ['insurance'],
		groupId: 'group-premium',
		groupTotal: 200,
		splitMethod: 'absolute',
		sourceType: 'insurance',
		sourceId: 'policy-1',
		createdAt: '2024-03-01T12:00:00.000Z',
		updatedAt: '2024-03-01T12:00:00.000Z'
	},
	{
		id: 'expense-premium-civic',
		vehicleId: VEHICLE_CIVIC.id,
		userId: E2E_USER.id,
		category: 'financial',
		expenseAmount: 80,
		date: '2024-03-01T12:00:00.000Z',
		description: 'Policy premium',
		tags: ['insurance'],
		groupId: 'group-premium',
		groupTotal: 200,
		splitMethod: 'absolute',
		sourceType: 'insurance',
		sourceId: 'policy-1',
		createdAt: '2024-03-01T12:00:00.000Z',
		updatedAt: '2024-03-01T12:00:00.000Z'
	}
];

const EXPENSES = [...BACKEND_EXPENSES, ...SPLIT_GROUP, ...INSURANCE_GROUP];

const INSURANCE_REASON = 'Delete the insurance policy to remove this expense';

async function openExpenses(page: Page) {
	await page.goto('/expenses');
	// Wait for the populated table; the loading shell would scan nothing.
	await expect(page.getByText('$45.50').filter({ visible: true }).first()).toBeVisible();
}

async function axeViolationIds(page: Page, testInfo: TestInfo, label: string) {
	return (await scanA11y(page, testInfo, `expenses-${label}`)).ids;
}

test.describe('Expense list accessibility — wide layout', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page, { expenses: EXPENSES });
	});

	test('scans clean with a split group collapsed and expanded', async ({ page }, testInfo) => {
		await openExpenses(page);

		expect(await axeViolationIds(page, testInfo, 'wide-collapsed')).toEqual([]);

		// Expand by keyboard: the portions must be reachable without a mouse.
		const disclosure = page.getByRole('button', { name: 'Split expense portions' }).first();
		await disclosure.focus();
		await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
		await page.keyboard.press('Enter');

		await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
		// The Civic portion only exists in the DOM while the group is expanded.
		await expect(page.getByRole('cell', { name: '$100.00' })).toBeVisible();

		expect(await axeViolationIds(page, testInfo, 'wide-expanded')).toEqual([]);

		await page.keyboard.press('Enter');
		await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByRole('cell', { name: '$100.00' })).toHaveCount(0);
	});

	test('the disclosure does not make a split row taller than a plain one', async ({ page }) => {
		await openExpenses(page);

		// Split rows must match plain rows' 32px action height or the table looks ragged.
		const plain = await page.getByRole('row', { name: /Costco fill-up/ }).boundingBox();
		const split = await page.getByRole('row', { name: /Shared detailing/ }).boundingBox();

		expect(split?.height).toBe(plain?.height);
	});

	test('a Delete blocked by an insurance policy stays focusable and explains itself', async ({
		page
	}) => {
		await openExpenses(page);

		// Hovering the row reveals its action cluster.
		const premiumRow = page.getByRole('row', { name: /Policy premium/ });
		await premiumRow.hover();
		const blockedDelete = premiumRow.getByRole('button', { name: 'Delete expense' });

		await expect(blockedDelete).toHaveAttribute('aria-disabled', 'true');
		await expect(blockedDelete).toHaveAccessibleDescription(INSURANCE_REASON);

		// Hover is a real pointer-events check: disabled kit controls set pointer-events: none.
		await blockedDelete.hover();
		await expect(blockedDelete).toHaveAttribute('title', INSURANCE_REASON);

		// `disabled` would make this unfocusable and hide the reason.
		await blockedDelete.focus();
		await expect(blockedDelete).toBeFocused();
		await page.keyboard.press('Enter');

		// Scoped to the toast; the same sentence also backs the button's aria-describedby.
		await expect(page.locator('[data-sonner-toast]').getByText(INSURANCE_REASON)).toBeVisible();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
	});
});

test.describe('Expense list accessibility — compact layout', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page, { expenses: EXPENSES });
	});

	test('scans clean with each kind of row showing its actions', async ({ page }, testInfo) => {
		await openExpenses(page);

		expect(await axeViolationIds(page, testInfo, 'compact-collapsed')).toEqual([]);

		// Edit and Delete must stay outside the row button, or axe reports nested-interactive.
		await page
			.getByRole('button', { name: /Costco fill-up|Fuel & Charging/ })
			.first()
			.click();
		await expect(page.getByRole('link', { name: 'Edit' }).first()).toBeVisible();
		expect(await axeViolationIds(page, testInfo, 'compact-standalone-selected')).toEqual([]);

		await page.getByRole('button', { name: /Split/ }).first().click();
		await expect(page.getByText('$100.00').filter({ visible: true }).first()).toBeVisible();
		expect(await axeViolationIds(page, testInfo, 'compact-split-selected')).toEqual([]);
	});

	test("Delete inside a split row's actions is reachable by keyboard", async ({ page }) => {
		await openExpenses(page);

		const splitRow = page.getByRole('button', { name: /Split/ }).first();
		await splitRow.focus();
		await page.keyboard.press('Enter');
		await expect(splitRow).toHaveAttribute('aria-expanded', 'true');

		// The row's keydown handler must not unmount this button before its click fires.
		const del = page.getByRole('button', { name: 'Delete', exact: true });
		await del.focus();
		await page.keyboard.press('Enter');

		const dialog = page.getByRole('alertdialog', { name: 'Delete Expense' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('every vehicle')).toBeVisible();
	});
});
