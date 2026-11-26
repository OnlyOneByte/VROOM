import { type Page, expect, test } from '@playwright/test';
import { ANALYTICS_SUMMARY, addSessionCookie, mockApi } from './support/mock-api';
import { scanA11y } from './support/axe';

const QUERY_SERIES: Record<string, Array<{ key: string; label: string }>> = {
	category: [
		{ key: 'fuel', label: 'Fuel' },
		{ key: 'maintenance', label: 'Maintenance' }
	],
	vehicle: [
		{ key: 'vehicle-camry', label: '2020 Toyota Camry' },
		{ key: 'vehicle-civic', label: '2019 Honda Civic' }
	],
	none: [{ key: 'total', label: 'Total cost' }]
};

function queryPayload(params: URLSearchParams) {
	const interval = params.get('interval') ?? 'month';
	const groupBy = params.get('groupBy') ?? 'none';
	const buckets = interval === 'none' ? ['total'] : ['2026-08', '2026-09', '2026-10', '2026-11'];
	const series = (QUERY_SERIES[groupBy] ?? QUERY_SERIES['none'] ?? []).map((s, i) => ({
		...s,
		values: buckets.map((_, b) => 100 * (i + 1) + 10 * b)
	}));
	const total = series.flatMap(s => s.values).reduce((sum, v) => sum + v, 0);
	const period = {
		range: { start: Number(params.get('start') ?? 1), end: Number(params.get('end') ?? 2) },
		buckets,
		series,
		totals: { value: total, perBucket: total / buckets.length, perDistance: 0.25, distance: 4000 }
	};
	return {
		metric: params.get('metric') ?? 'cost',
		unit: 'USD',
		interval,
		groupBy,
		...period,
		compare: { ...period, totals: { ...period.totals, perBucket: total / buckets.length / 2 } },
		...(params.get('annotations') && {
			annotations: [
				{
					t: Math.floor(new Date(2026, 7, 15, 12).getTime() / 1000),
					kind: 'service',
					vehicleId: 'vehicle-camry',
					vehicleName: '2020 Toyota Camry',
					label: 'Brake pads',
					amount: 300
				}
			],
			trips: {
				count: buckets.map((_, b) => (b === 1 ? 2 : 0)),
				distance: buckets.map((_, b) => (b === 1 ? 42 : 0))
			}
		})
	};
}

const BUCKET_ITEMS = {
	total: 230,
	count: 4,
	fuel: { total: 100, count: 2 },
	items: [
		{
			id: 'e1',
			date: 1754784000,
			category: 'maintenance',
			vehicleId: 'vehicle-camry',
			vehicleName: '2020 Toyota Camry',
			description: 'Brake pads',
			amount: 110
		}
	],
	others: { total: 20, count: 1 },
	categories: ['fuel', 'maintenance', 'regulatory', 'enhancement', 'misc']
};

const INSIGHTS = [
	{
		id: 'repairFree',
		title: 'Repair-free streak',
		value: 150,
		unit: 'days',
		sentence: 'Civic: no repairs since Jul 4, 2025. Oil changes, rotations and washes don’t count.',
		query: { metric: 'cost', per: 'month', split: 'category', range: 'all', cars: 'vehicle-civic' }
	},
	{
		id: 'recordMonth',
		title: 'Record month',
		value: 230,
		unit: 'money',
		sentence: 'August 2026 had the highest running costs in this period.',
		query: { metric: 'cost', per: 'month', split: 'category', sel: '2026-08' }
	}
];

async function mockAnalytics(page: Page, requests: URLSearchParams[] = []) {
	await mockApi(page);
	await page.route(
		url => url.pathname === '/api/v1/analytics/insights',
		route =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true, data: INSIGHTS })
			})
	);
	await page.route(
		url => url.pathname === '/api/v1/analytics/query/items',
		route =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true, data: BUCKET_ITEMS })
			})
	);
	await page.route(
		url => url.pathname === '/api/v1/analytics/query',
		route => {
			const params = new URL(route.request().url()).searchParams;
			requests.push(params);
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true, data: queryPayload(params) })
			});
		}
	);
}

async function openFuelTab(page: Page) {
	await page.getByRole('tab', { name: 'Fuel & charging', exact: true }).click();
	await expect(page.getByText('Fuel spend per month')).toBeVisible();
}

async function openFillupDetails(page: Page) {
	await openFuelTab(page);
	const group = page.locator('details[data-slot="chart-group"]', { hasText: 'Fill-up details' });
	if (!(await group.evaluate(el => (el as HTMLDetailsElement).open))) {
		await group.locator('summary').click();
	}
}

test.describe('Analytics', () => {
	test.beforeEach(async ({ context }) => {
		await addSessionCookie(context);
	});

	test('loads the quick stats and the tab bar', async ({ page }) => {
		await mockAnalytics(page);

		await page.goto('/analytics');

		await expect(page).toHaveTitle(/Analytics/);
		await expect(page.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible();
		await expect(page.getByText('Total Vehicles')).toHaveCount(0);

		for (const tab of [
			'Explore',
			'Fuel & charging',
			'Cross-vehicle',
			'Per-vehicle',
			'Year in review'
		]) {
			await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
			await expect(page.getByRole('tab', { name: tab, exact: true })).toBeInViewport({ ratio: 1 });
		}
	});

	test('a short landscape window opens at the top of the page', async ({ page }) => {
		await page.setViewportSize({ width: 740, height: 360 });
		await mockAnalytics(page);

		await page.goto('/analytics');
		await expect(page.getByRole('tab', { name: 'Year in review', exact: true })).toBeAttached();
		await expect(
			page.getByRole('heading', { name: 'Total cost per month by category' })
		).toBeAttached();

		expect(await page.evaluate(() => window.scrollY)).toBe(0);
	});

	test('the fuel tab renders the figures from the summary payload', async ({ page }) => {
		await mockAnalytics(page);

		await page.goto('/analytics');

		await openFillupDetails(page);
		await expect(page.getByRole('heading', { name: 'Fill-ups', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Fuel Consumption' })).toBeVisible();
		const fillups = ANALYTICS_SUMMARY.fuelStats.fillups.currentYear;
		await expect(page.getByText(String(fillups), { exact: true }).first()).toBeVisible();
	});

	test('switching tabs moves the selection off the fuel tab', async ({ page }) => {
		await mockAnalytics(page);

		await page.goto('/analytics');
		await openFillupDetails(page);
		await expect(page.getByRole('heading', { name: 'Fill-ups', exact: true })).toBeVisible();

		await page.getByRole('tab', { name: 'Cross-vehicle', exact: true }).click();

		await expect(page.getByRole('tab', { name: 'Cross-vehicle', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.getByRole('heading', { name: 'Fill-ups', exact: true })).toBeHidden();
	});

	test('a fleet with no vehicles shows the Add Vehicle empty state, not zeroed stats', async ({
		page
	}) => {
		await mockApi(page, { vehicles: [], expenses: [] });
		await page.route(
			url => url.pathname === '/api/v1/analytics/summary',
			route =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						success: true,
						data: {
							...ANALYTICS_SUMMARY,
							quickStats: {
								...ANALYTICS_SUMMARY.quickStats,
								vehicleCount: 0,
								ytdSpending: 0,
								avgEfficiency: null,
								costPerDistance: null,
								fleetHealthScore: 0
							},
							fuelStats: {
								...ANALYTICS_SUMMARY.fuelStats,
								fillups: { currentYear: 0, previousYear: 0, currentMonth: 0, previousMonth: 0 },
								distance: { totalDistance: 0, avgPerDay: null, avgPerMonth: null }
							}
						}
					})
				})
		);

		await page.goto('/analytics');

		await expect(page.getByRole('heading', { name: 'Add a vehicle first' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Add Vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
		await expect(page.getByText('$0.00')).toBeHidden();
		await expect(page.getByRole('tablist')).toBeHidden();
		await expect(page.getByRole('heading', { name: 'Fill-ups', exact: true })).toBeHidden();
	});

	test('a failed load shows an error with a retry that re-requests', async ({ page }) => {
		await mockAnalytics(page);
		let attempts = 0;
		await page.route(
			url => url.pathname === '/api/v1/analytics/summary',
			route => {
				attempts += 1;
				return route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ success: false, error: { message: 'Server error' } })
				});
			}
		);

		await page.goto('/analytics');

		await expect(page.getByText("Couldn't load analytics")).toBeVisible();
		const retry = page.getByRole('button', { name: 'Retry' });
		await expect(retry).toBeVisible();
		await page.mouse.move(640, 600);

		await retry.click();
		await expect.poll(() => attempts).toBeGreaterThan(1);
	});

	test('Explore builds a query, keeps it in the URL and survives a reload', async ({
		page
	}, testInfo) => {
		const requests: URLSearchParams[] = [];
		await mockAnalytics(page, requests);

		await page.goto('/analytics');

		await expect(page.getByRole('tab', { name: 'Explore', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(
			page.getByRole('heading', { name: 'Total cost per month by category' })
		).toBeVisible();
		await expect.poll(() => requests.at(-1)?.get('groupBy')).toBe('category');
		expect(requests.at(-1)?.get('include')).toBe('running');

		const { ids } = await scanA11y(page, testInfo, 'explore');
		expect(ids).toEqual([]);

		await page.getByRole('button', { name: 'Metric Total cost' }).click();
		await page.getByRole('button', { name: 'Cost per mile' }).click();
		await expect(page).toHaveURL(/metric=costPerDistance/);
		await page.getByRole('button', { name: /^Split by/ }).click();
		await page.getByRole('button', { name: 'Car', exact: true }).click();
		await expect(page).toHaveURL(/split=vehicle/);
		await expect(
			page.getByRole('heading', { name: 'Cost per mile per month by car' })
		).toBeVisible();
		await expect.poll(() => requests.at(-1)?.get('metric')).toBe('costPerDistance');

		await page.getByRole('button', { name: 'By Month' }).click();
		await page.getByRole('button', { name: 'Quarter', exact: true }).click();
		await expect(page).toHaveURL(/per=quarter/);
		await expect.poll(() => requests.at(-1)?.get('interval')).toBe('quarter');

		await page.getByRole('button', { name: /12 months/ }).click();
		await page.getByRole('radio', { name: 'Year to date' }).click();
		await expect(page).toHaveURL(/range=ytd/);
		const yearStart = await page.evaluate(() =>
			String(Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000))
		);
		await expect.poll(() => requests.at(-1)?.get('start')).toBe(yearStart);

		await page.getByRole('button', { name: /2020 Toyota Camry/ }).click();
		await expect(page).toHaveURL(/hide=vehicle-camry/);
		await expect(page.getByRole('button', { name: /2020 Toyota Camry/ })).toHaveAttribute(
			'aria-pressed',
			'false'
		);

		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Cost per mile per quarter by car' })
		).toBeVisible();
		await expect(page.getByRole('button', { name: /2020 Toyota Camry/ })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		await expect(page.getByRole('button', { name: /Year to date/ })).toBeVisible();

		await page.goBack();
		await expect(page).not.toHaveURL(/hide=vehicle-camry/);
	});

	test('a comparison lists each bucket’s change in Table view', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics?split=none&compare=prevPeriod');
		await page.mouse.move(640, 600);
		const heading = page
			.getByRole('heading', { name: 'Total cost per month, against the period before', level: 2 })
			.last();
		await heading.scrollIntoViewIfNeeded();
		await page.getByRole('button', { name: 'Table', exact: true }).first().click();
		const table = page.getByRole('region', { name: /against the period before table/ });
		await expect(table.getByRole('row')).toHaveCount(5);
		await expect(table.getByRole('cell', { name: '$100.00 (= 0%)' })).toBeVisible();
	});

	test('the hero and chips follow the view in the URL', async ({ page }) => {
		await mockAnalytics(page);
		const views: Array<[string, string, string]> = [
			['', 'Total cost per month by category', 'Metric Total cost'],
			[
				'?split=fuelType&inc=all',
				'Total cost per month by fuel type',
				'Metric Total cost, all costs'
			],
			[
				'?split=none&compare=prevYear',
				'Total cost per month, against the year before',
				'Compare The year before'
			],
			['?metric=mpg&per=quarter&split=vehicle', 'Fuel efficiency per quarter by car', 'By Quarter']
		];
		for (const [search, heading, chip] of views) {
			await page.goto(`/analytics${search}`);
			await expect(page.getByRole('heading', { name: heading })).toBeVisible();
			await expect(page.getByRole('button', { name: chip })).toBeVisible();
			await expect(page.getByText(/for all your cars\./)).toBeVisible();
		}
	});

	test('drill down from a month to a car and on to its expenses', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics?split=vehicle');
		await page.mouse.move(640, 600);

		await page
			.getByRole('heading', { name: 'Total cost per month by car' })
			.scrollIntoViewIfNeeded();
		const chart = page
			.getByRole('img', { name: /Total cost per month by car/ })
			.and(page.locator('[tabindex="0"]'));
		await chart.focus();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Enter');

		const panel = page.getByRole('dialog');
		await expect(panel.getByRole('heading', { name: 'Aug ’26' })).toBeVisible();
		await expect(page).toHaveURL(/sel=2026-08/);
		await expect(panel.getByText('Brake pads')).toBeVisible();
		await expect(panel.getByText('Fuel & charging')).toBeVisible();
		await expect(panel.getByRole('link', { name: /Open in Expenses/ })).toHaveAttribute(
			'href',
			/category=fuel%2Cmaintenance%2Cregulatory%2Cenhancement%2Cmisc&startDate=2026-08-01&endDate=2026-08-31/
		);
		await expect(page.getByRole('navigation', { name: 'Drill path' })).toContainText('Aug ’26');

		await page.keyboard.press('Escape');
		await expect(panel).toBeHidden();
		await expect(page).not.toHaveURL(/sel=/);
		await expect(chart).toBeFocused();

		await chart.click({ position: { x: 300, y: 150 } });
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('dialog').getByRole('button', { name: 'Show only' }).first().click();
		await expect(page).toHaveURL(/cars=vehicle-civic/);
		await expect(page).not.toHaveURL(/sel=/);
	});

	test('a tag bar takes its value from the expenses, counted once', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics?split=tag&sel=2026-08');
		const panel = page.getByRole('dialog');
		await expect(panel.getByRole('heading', { name: 'Aug ’26' })).toBeVisible();
		await expect(panel.getByText('$230.00', { exact: true })).toBeVisible();
		await expect(panel.getByText(/below your average|above your average/)).toHaveCount(0);
	});

	test('a selection that no longer matches a bar opens nothing', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics?split=vehicle&sel=1999-01&seg=gone');
		const path = page.getByRole('navigation', { name: 'Drill path' });
		await expect(path).toContainText('Select a bar or point to see its expenses');
		await expect(path.getByRole('button', { name: 'Last 12 months' })).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('an insight card loads the chart that proves it', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics');
		await page.mouse.move(640, 600);
		const insights = page.getByRole('region', { name: 'Things we noticed' });
		await insights.scrollIntoViewIfNeeded();
		await expect(insights.getByText('150 days')).toBeVisible();
		await insights.getByRole('button', { name: 'Show in Chart: Repair-free streak' }).click();
		await expect(page).toHaveURL(/range=all/);
		await expect(page).toHaveURL(/cars=vehicle-civic/);
		await expect(
			page.getByRole('heading', { name: 'Total cost per month by category' })
		).toBeVisible();
	});

	test('the record month card opens that month in the drill-down panel', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics');
		await page.mouse.move(640, 600);
		const insights = page.getByRole('region', { name: 'Things we noticed' });
		await insights.scrollIntoViewIfNeeded();
		await insights.getByRole('button', { name: 'Show in Chart: Record month' }).click();
		await expect(page).toHaveURL(/sel=2026-08/);
		await expect(page.getByRole('dialog').getByRole('heading', { name: 'Aug ’26' })).toBeVisible();
	});

	test('each car on its own draws one panel per car on a shared scale', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics?metric=costPerDistance&compare=cars');
		await page.mouse.move(640, 600);
		const panels = page.getByRole('region', { name: /each car on its own/ });
		await expect(panels).toBeVisible();
		await expect(panels.getByRole('heading', { level: 3 })).toHaveCount(2);
		await expect(panels).toContainText('The dashed line is the fleet average');
		await expect(page).toHaveURL(/compare=cars/);

		await panels
			.getByRole('heading', { level: 3 })
			.first()
			.evaluate(e => e.scrollIntoView({ block: 'start' }));
		const first = panels
			.getByRole('img', { name: /^2020 Toyota Camry:/ })
			.and(page.locator('[tabindex="0"]'));
		await first.focus();
		await expect(first).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/seg=vehicle-camry/);
		await expect(page.getByRole('dialog').getByRole('heading').first()).toContainText(
			'2020 Toyota Camry'
		);
	});

	test('a failed per-car average shows an error with Retry, not an empty range', async ({
		page
	}) => {
		await mockAnalytics(page);
		let failing = true;
		let release = () => {};
		let held = Promise.resolve();
		await page.route(
			url =>
				url.pathname === '/api/v1/analytics/query' && url.searchParams.get('interval') === 'none',
			async route => {
				await held;
				return failing
					? route.fulfill({
							status: 500,
							contentType: 'application/json',
							body: JSON.stringify({ success: false, error: { message: 'Server error' } })
						})
					: route.fallback();
			}
		);
		await page.goto('/analytics?metric=costPerDistance&compare=cars');
		await page.mouse.move(640, 600);
		const panels = page.getByRole('region', { name: /each car on its own/ });
		const failure = panels.getByText("Couldn't work out each car's average");
		await expect(failure).toBeVisible();
		await expect(panels.getByText('No data in this range')).toHaveCount(0);
		await expect(panels.getByText('Average not available')).toHaveCount(2);

		held = new Promise(resolve => (release = resolve));
		await panels.getByRole('button', { name: 'Retry' }).click();
		await expect(panels.getByRole('button', { name: 'Retrying…' })).toBeVisible();
		release();
		await expect(panels.getByRole('button', { name: 'Retry' })).toBeFocused();
		await expect(failure).toBeVisible();

		failing = false;
		await panels.getByRole('button', { name: 'Retry' }).click();
		await expect(failure).toHaveCount(0);
		await expect(panels.getByText(/^Average /)).toHaveCount(2);
		await expect(panels.getByText('Average not available')).toHaveCount(0);
		await expect(panels.getByRole('heading', { level: 2 })).toBeFocused();
	});

	test('services sit in a lane above the chart, reachable by keyboard and listed in Table view', async ({
		page
	}, testInfo) => {
		const requests: URLSearchParams[] = [];
		await mockAnalytics(page, requests);
		await page.goto('/analytics');
		await page.mouse.move(640, 600);
		await expect.poll(() => requests.at(-1)?.get('annotations')).toBe('services,trips');
		await page
			.getByRole('heading', { name: 'Total cost per month by category', level: 2 })
			.last()
			.scrollIntoViewIfNeeded();
		const lane = page.getByRole('group', { name: /Services and trips: 1 marker/ });
		await lane.focus();
		await expect(lane).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(
			page.getByText(/: Brake pads\. 2020 Toyota Camry, \$300\.00 1 of 1\./)
		).toBeAttached();
		const laneScan = await scanA11y(page, testInfo, 'annotation-lane');
		expect(laneScan.ids).toEqual([]);
		await page.getByRole('button', { name: 'Table', exact: true }).first().click();
		const events = page.getByRole('region', { name: /Services and trips/ });
		await expect(events).toContainText('Brake pads: 2020 Toyota Camry, $300.00');
		await expect(events).toContainText('2 trips, 42 mi');
		const tableScan = await scanA11y(page, testInfo, 'annotation-events');
		expect(tableScan.ids).toEqual([]);
	});
});
