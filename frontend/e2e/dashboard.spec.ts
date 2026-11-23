import { test, expect, type Page, type Route } from '@playwright/test';
import { VEHICLE_CAMRY, VEHICLE_CIVIC, addSessionCookie, mockApi } from './support/mock-api';

const DAY = 24 * 60 * 60 * 1000;

function json(route: Route, data: unknown) {
	return route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({ success: true, data })
	});
}

const SUMMARY_30D = {
	totalAmount: 624.04,
	expenseCount: 9,
	monthlyAverage: 624.04,
	recentAmount: 624.04,
	categoryBreakdown: [
		{ category: 'financial', amount: 372.86, count: 1 },
		{ category: 'fuel', amount: 168.19, count: 5 },
		{ category: 'maintenance', amount: 82.99, count: 3 }
	],
	monthlyTrend: [],
	costBuckets: {
		ownershipTotal: 372.86,
		runningTotal: 251.18,
		previous: { ownershipTotal: 372.86, runningTotal: 291.14 },
		byVehicle: [
			{ vehicleId: VEHICLE_CAMRY.id, ownershipTotal: 372.86, runningTotal: 127.93, previous: null },
			{ vehicleId: VEHICLE_CIVIC.id, ownershipTotal: 0, runningTotal: 123.25, previous: null }
		]
	}
};

const PER_DISTANCE = {
	metric: 'costPerDistance',
	unit: 'USD/miles',
	interval: 'none',
	groupBy: 'vehicle',
	range: { start: 0, end: 0 },
	buckets: ['total'],
	series: [
		{ key: VEHICLE_CAMRY.id, label: 'Camry', values: [0.13] },
		{ key: VEHICLE_CIVIC.id, label: 'Civic', values: [0.09] }
	],
	totals: { value: 0.11, perBucket: null, perDistance: 0.11, distance: 2200 },
	compare: null
};

function monthly(groupBy: 'none' | 'vehicle') {
	const buckets = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
	const series =
		groupBy === 'none'
			? [{ key: 'total', label: 'Total', values: [310, 420, 812, 390, 365, 251] }]
			: [
					{ key: VEHICLE_CAMRY.id, label: 'Camry', values: [500, 520, 900, 480, 470, 500] },
					{ key: VEHICLE_CIVIC.id, label: 'Civic', values: [80, 95, 60, 120, 110, 123] }
				];
	return {
		metric: 'cost',
		unit: 'USD',
		interval: 'month',
		groupBy,
		range: { start: 0, end: 0 },
		buckets,
		series,
		totals: { value: null, perBucket: null, perDistance: null, distance: 0 },
		compare: null
	};
}

async function mockDashboard(page: Page, overdue = true) {
	await page.route('**/api/v1/expenses/summary**', route => {
		const period = new URL(route.request().url()).searchParams.get('period');
		return json(route, period === 'all' ? { ...SUMMARY_30D, expenseCount: 40 } : SUMMARY_30D);
	});
	await page.route('**/api/v1/analytics/query**', route => {
		const params = new URL(route.request().url()).searchParams;
		if (params.get('metric') === 'costPerDistance') return json(route, PER_DISTANCE);
		return json(route, monthly(params.get('groupBy') === 'vehicle' ? 'vehicle' : 'none'));
	});
	await page.route('**/api/v1/reminders', route =>
		json(
			route,
			overdue
				? [
						{
							reminder: {
								id: 'r1',
								name: 'Oil change',
								isActive: true,
								nextDueDate: new Date(Date.now() - 2 * DAY).toISOString(),
								expenseAmount: null
							},
							vehicleIds: [VEHICLE_CAMRY.id]
						}
					]
				: []
		)
	);
}

test.describe('Dashboard', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('at 375 the hero, its change and the split bar sit in the first 300px of the page body', async ({
		page
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await mockDashboard(page);
		await page.goto('/dashboard');

		const hero = page.getByTestId('dashboard-hero');
		await expect(hero.getByText('$624.04')).toBeVisible();
		await expect(hero.getByText('6% less than')).toBeVisible();
		await expect(hero.getByText('$0.11/mi')).toBeVisible();

		const main = await page.locator('main').boundingBox();
		const bar = await page.getByTestId('dashboard-split-bar').boundingBox();
		expect(main).not.toBeNull();
		expect(bar).not.toBeNull();
		expect(bar!.y + bar!.height - main!.y).toBeLessThanOrEqual(300);

		const height = await page.evaluate(() => document.documentElement.scrollHeight);
		expect(height).toBeLessThanOrEqual(3 * 812);
	});

	test('nothing on screen moves while the Dashboard loads at 375', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await mockDashboard(page);
		await page.goto('/dashboard');
		await expect(page.getByTestId('vehicle-rows')).toBeVisible();
		await page.waitForTimeout(1000);

		const shift = await page.evaluate(
			() =>
				new Promise<number>(resolve => {
					let total = 0;
					new PerformanceObserver(list => {
						for (const entry of list.getEntries() as Array<
							PerformanceEntry & { value: number; hadRecentInput: boolean }
						>) {
							if (!entry.hadRecentInput) total += entry.value;
						}
					}).observe({ type: 'layout-shift', buffered: true });
					setTimeout(() => resolve(total), 200);
				})
		);
		expect(shift).toBeLessThanOrEqual(0.01);
	});

	test('every vehicle is a row at 375 with no horizontal scrolling', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await mockDashboard(page);
		await page.goto('/dashboard');

		const rows = page.getByTestId('vehicle-rows').getByRole('listitem');
		await expect(rows).toHaveCount(2);
		for (const row of await rows.all()) {
			const box = await row.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(375);
		}
		await expect(rows.first()).toContainText('$500.79');
		await expect(rows.first()).toContainText('$0.13/mi');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});

	test('an overdue reminder is under Needs attention', async ({ page }) => {
		await mockDashboard(page);
		await page.goto('/dashboard');
		const card = page.getByTestId('needs-attention');
		await expect(card).toContainText('Oil change');
		await expect(card).toContainText('Overdue');
	});

	test('with nothing due there is no Needs attention card', async ({ page }) => {
		await mockDashboard(page, false);
		await page.goto('/dashboard');
		await expect(page.getByTestId('dashboard-hero').getByText('$624.04')).toBeVisible();
		await expect(page.getByTestId('needs-attention')).toHaveCount(0);
	});

	test('the last 12 months chart names its highest month', async ({ page }) => {
		await mockDashboard(page);
		await page.goto('/dashboard');

		await expect(page.getByTestId('trend-insight')).toHaveText('Highest: August 2026, $812.00.');
	});
});
