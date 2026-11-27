import { test, expect, type Page } from '@playwright/test';
import { addSessionCookie, fulfillData, mockApi } from './support/mock-api';

const VEHICLE = '/vehicles/vehicle-camry';

async function holdVehicleLists(page: Page, post: 'slow' | 'quick') {
	let release: () => void = () => {};
	const held = new Promise<void>(resolve => (release = resolve));
	let saved = false;
	await page.route(
		url => url.pathname === '/api/v1/expenses',
		async route => {
			if (route.request().method() === 'POST') {
				saved = true;
				if (post === 'slow') await new Promise(resolve => setTimeout(resolve, 3000));
				return route.fallback();
			}
			const forVehicle = new URL(route.request().url()).searchParams.get('vehicleId');
			if (saved && forVehicle === 'vehicle-camry') await held;
			return route.fallback();
		}
	);
	return { release: () => release(), saved: () => saved };
}

async function saveFromVehicle(page: Page) {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`/expenses/new?vehicleId=vehicle-camry&returnTo=${VEHICLE}`);
	await page.getByRole('radio', { name: 'Misc' }).click();
	await page.getByLabel('Amount *').fill('12.34');
	await page.getByRole('button', { name: /More details/ }).click();
	await page.getByLabel('Description (Optional)').fill('Car wash on Elm');
	await page.getByRole('button', { name: 'Save Expense' }).click();
	await expect(page).toHaveURL(new RegExp(`${VEHICLE}$`));
}

test.describe("A new expense shows on its vehicle's page before the page's lists load", () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	for (const post of ['slow', 'quick'] as const) {
		const state = post === 'slow' ? 'still saving' : 'just synced';
		test(`a ${state} row is in the Recent card and the Expenses tab while their fetches are held`, async ({
			page
		}) => {
			const lists = await holdVehicleLists(page, post);
			await saveFromVehicle(page);
			expect(lists.saved()).toBe(true);

			const recent = page.locator('section, div').filter({
				has: page.getByRole('heading', { name: 'Recent expenses' })
			});
			await expect(recent.getByText('Car wash on Elm').first()).toBeVisible();

			await page.getByRole('tab', { name: 'Expenses' }).click();
			const tab = page.getByRole('tabpanel', { name: 'Expenses' });
			await expect(tab.getByRole('row', { name: /Car wash on Elm/ })).toBeVisible();
			await expect(tab.getByText('All Expenses (1)')).toBeVisible();

			lists.release();
		});
	}
});

test.describe("A car's first expense shows instead of the empty overview", () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page, { expenses: [] });
		await page.route(
			url => url.pathname === '/api/v1/expenses/summary',
			route =>
				fulfillData(route, {
					totalAmount: 0,
					expenseCount: 0,
					monthlyAverage: 0,
					recentAmount: 0,
					categoryBreakdown: [],
					monthlyTrend: []
				})
		);
	});

	for (const post of ['slow', 'quick'] as const) {
		const state = post === 'slow' ? 'still saving' : 'just synced';
		test(`a ${state} first expense replaces "no expenses yet" on the overview`, async ({
			page
		}) => {
			await holdVehicleLists(page, post);
			await saveFromVehicle(page);

			const overview = page.getByRole('tabpanel', { name: 'Overview' });
			await expect(overview.getByRole('heading', { name: 'Recent expenses' })).toBeVisible();
			await expect(overview.getByText('Car wash on Elm')).toBeVisible();
			await expect(
				overview.getByText('Start tracking expenses for this vehicle to see insights and trends')
			).toHaveCount(0);
		});
	}
});
