import { type Page, expect, test } from '@playwright/test';
import { ANALYTICS_SUMMARY, addSessionCookie, mockApi } from './support/mock-api';
import { scanA11y } from './support/axe';

const QUERY_SERIES: Record<string, Array<{ key: string; label: string }>> = {
	category: [
		{ key: 'fuel', label: 'Fuel' },
		{ key: 'maintenance', label: 'Maintenance' }
	],
	vehicle: [
		{ key: 'camry', label: '2020 Toyota Camry' },
		{ key: 'civic', label: '2019 Honda Civic' }
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
		range: { start: 1, end: 2 },
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
		compare: { ...period, totals: { ...period.totals, perBucket: total / buckets.length / 2 } }
	};
}

async function mockAnalytics(page: Page, requests: URLSearchParams[] = []) {
	await mockApi(page);
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
	await page.getByRole('tab', { name: 'Fuel & Stats', exact: true }).click();
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
		await expect(page.getByRole('heading', { name: 'Analytics Dashboard' })).toBeVisible();

		await expect(page.getByText('Total Vehicles')).toBeVisible();
		await expect(page.getByText('YTD Spending')).toBeVisible();
		await expect(page.getByText('Cost per mi', { exact: true })).toBeVisible();
		await expect(page.getByText('Fleet Health')).toBeVisible();
		await expect(
			page.getByText(`${ANALYTICS_SUMMARY.quickStats.fleetHealthScore} / 100`)
		).toBeVisible();
		await expect(page.getByText('$5,000.00')).toBeVisible();

		for (const tab of ['Explore', 'Fuel & Stats', 'Cross-Vehicle', 'Per-Vehicle', 'Year-End']) {
			await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
			await expect(page.getByRole('tab', { name: tab, exact: true })).toBeInViewport({ ratio: 1 });
		}
	});

	test('a short landscape window opens at the top of the page', async ({ page }) => {
		await page.setViewportSize({ width: 740, height: 360 });
		await mockAnalytics(page);

		await page.goto('/analytics');
		await expect(page.getByRole('tab', { name: 'Year-End', exact: true })).toBeAttached();
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

		await page.getByRole('tab', { name: 'Cross-Vehicle', exact: true }).click();

		await expect(page.getByRole('tab', { name: 'Cross-Vehicle', exact: true })).toHaveAttribute(
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

		await page.getByRole('button', { name: 'Cost per mile' }).click();
		await expect(page).toHaveURL(/metric=costPerDistance/);
		await expect(page).toHaveURL(/split=vehicle/);
		await expect(
			page.getByRole('heading', { name: 'Cost per mile per month by car' })
		).toBeVisible();
		await expect.poll(() => requests.at(-1)?.get('metric')).toBe('costPerDistance');

		await page.getByRole('button', { name: 'Edit' }).click();
		await page.getByRole('radio', { name: 'Quarter', exact: true }).click();
		await page.getByRole('button', { name: 'Done' }).click();
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
		await expect(page).toHaveURL(/hide=camry/);
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
		await expect(page).not.toHaveURL(/hide=camry/);
	});

	test('every Explore preset renders and round-trips through the URL', async ({ page }) => {
		await mockAnalytics(page);
		await page.goto('/analytics');
		const presets: Array<[string, string]> = [
			['Where the money goes', 'Total cost per month by category'],
			['Cost per mile', 'Cost per mile per month by car'],
			['Fuel vs charging', 'Total cost per month by fuel type'],
			['This year vs last', 'Total cost per month, against the year before'],
			['Seasons', 'Fuel efficiency per quarter by car']
		];
		for (const [preset, heading] of presets) {
			await page.mouse.move(640, 600);
			await page.getByRole('button', { name: preset }).click();
			await expect(page.getByRole('heading', { name: heading })).toBeVisible();
			const url = page.url();
			await page.reload();
			await expect(page).toHaveURL(url);
			await expect(page.getByRole('heading', { name: heading })).toBeVisible();
			await expect(page.getByRole('button', { name: preset })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
		}
	});
});
