import { expect, test } from '@playwright/test';
import { ANALYTICS_SUMMARY, addSessionCookie, mockApi } from './support/mock-api';

/**
 * The analytics dashboard.
 *
 * The page makes ONE call on load — `GET /api/v1/analytics/summary` — which returns
 * quickStats + fuelStats + fuelAdvanced together. (The previous version of this file
 * mocked `/analytics/quick-stats`, an endpoint the page only reaches through
 * `getSummary`'s 404/network fallback, so the page's real request was unmocked.) It is
 * also a protected route, so `/auth/me` has to answer or the layout redirects to `/auth`
 * before anything renders.
 */

test.describe('Analytics', () => {
	test.beforeEach(async ({ context }) => {
		await addSessionCookie(context);
	});

	test('loads the quick stats and the tab bar', async ({ page }) => {
		await mockApi(page);

		await page.goto('/analytics');

		await expect(page).toHaveTitle(/Analytics/);
		await expect(page.getByRole('heading', { name: 'Analytics Dashboard' })).toBeVisible();

		await expect(page.getByText('Total Vehicles')).toBeVisible();
		await expect(page.getByText('YTD Spending')).toBeVisible();
		// The efficiency card's label is unit-derived, not the literal "Avg MPG".
		await expect(page.getByText('Avg mi/gal')).toBeVisible();
		await expect(page.getByText('Fleet Health')).toBeVisible();
		await expect(page.getByText('$5,000.00')).toBeVisible();

		for (const tab of ['Fuel & Stats', 'Cross-Vehicle', 'Per-Vehicle', 'Year-End']) {
			await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
		}
	});

	test('the fuel tab renders the figures from the summary payload', async ({ page }) => {
		await mockApi(page);

		await page.goto('/analytics');

		await expect(page.getByRole('heading', { name: 'Fill-ups' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Fuel Consumption' })).toBeVisible();
		const fillups = ANALYTICS_SUMMARY.fuelStats.fillups.currentYear;
		await expect(page.getByText(String(fillups), { exact: true }).first()).toBeVisible();
	});

	test('switching tabs moves the selection off the fuel tab', async ({ page }) => {
		await mockApi(page);

		await page.goto('/analytics');
		await expect(page.getByRole('heading', { name: 'Fill-ups' })).toBeVisible();

		await page.getByRole('tab', { name: 'Cross-Vehicle', exact: true }).click();

		// Only the selection + panel swap is asserted: each non-fuel tab lazy-loads its own
		// chart bundle and its own endpoint, which this spec deliberately does not fixture.
		await expect(page.getByRole('tab', { name: 'Cross-Vehicle', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.getByRole('heading', { name: 'Fill-ups' })).toBeHidden();
	});

	test('a fleet with no data still renders, with zeroed stats', async ({ page }) => {
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

		await expect(page.getByText('$0.00')).toBeVisible();
		// avgEfficiency null renders as N/A rather than a misleading 0.
		await expect(page.getByText('N/A')).toBeVisible();
		// With no fill-ups and no distance the fuel tab collapses to one empty state
		// instead of ten "no data" cards.
		await expect(page.getByRole('heading', { name: 'Fill-ups' })).toBeHidden();
	});

	test('a failed load shows an error with a retry that re-requests', async ({ page }) => {
		await mockApi(page);
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

		await expect(page.getByText('Failed to load analytics')).toBeVisible();
		const retry = page.getByRole('button', { name: 'Retry' });
		await expect(retry).toBeVisible();

		await retry.click();
		await expect.poll(() => attempts).toBeGreaterThan(1);
	});
});
