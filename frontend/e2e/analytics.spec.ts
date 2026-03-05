import { expect, test } from '@playwright/test';

test.describe('Analytics Page', () => {
	test.beforeEach(async ({ context }) => {
		// Set up authenticated session
		await context.addCookies([
			{
				name: 'auth_session',
				value: 'mock-session-token',
				domain: 'localhost',
				path: '/',
				httpOnly: true,
				sameSite: 'Lax'
			}
		]);
	});

	test('should load analytics page without errors', async ({ page }) => {
		// Mock quick stats API
		await page.route('**/api/v1/analytics/quick-stats*', async route => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					data: {
						vehicleCount: 2,
						ytdSpending: 5000,
						avgMpg: 28.5,
						fleetHealthScore: 85
					}
				})
			});
		});

		await page.goto('/analytics');

		// Verify page title
		await expect(page).toHaveTitle(/Analytics/);

		// Verify quick stats cards are visible
		await expect(page.getByText('Vehicles')).toBeVisible();
		await expect(page.getByText('YTD Spending')).toBeVisible();
		await expect(page.getByText('Avg MPG')).toBeVisible();
		await expect(page.getByText('Fleet Health')).toBeVisible();

		// Verify tab navigation is present
		await expect(page.getByRole('tab', { name: /Fuel & Stats/i })).toBeVisible();
		await expect(page.getByRole('tab', { name: /Cross-Vehicle/i })).toBeVisible();
		await expect(page.getByRole('tab', { name: /Per-Vehicle/i })).toBeVisible();
		await expect(page.getByRole('tab', { name: /Year-End Summary/i })).toBeVisible();
	});

	test('should switch between tabs', async ({ page }) => {
		// Mock APIs
		await page.route('**/api/v1/analytics/**', async route => {
			const url = route.request().url();
			if (url.includes('quick-stats')) {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						success: true,
						data: { vehicleCount: 1, ytdSpending: 1000, avgMpg: 30, fleetHealthScore: 90 }
					})
				});
			} else if (url.includes('fuel-stats')) {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						success: true,
						data: {
							fillups: { currentYear: 10, previousYear: 8, currentMonth: 2, previousMonth: 1 },
							gallons: { currentYear: 100, previousYear: 80, currentMonth: 20, previousMonth: 10 },
							fuelConsumption: { avgMpg: 30, bestMpg: 35, worstMpg: 25 },
							fillupDetails: { avgVolume: 10, minVolume: 8, maxVolume: 12 },
							averageCost: {
								perFillup: 50,
								bestCostPerMile: 0.15,
								worstCostPerMile: 0.25,
								avgCostPerDay: 5
							},
							distance: { totalMiles: 3000, avgPerDay: 10, avgPerMonth: 300 },
							monthlyConsumption: [],
							gasPriceHistory: [],
							fillupCostByVehicle: [],
							odometerProgression: [],
							costPerMile: []
						}
					})
				});
			} else {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ success: true, data: {} })
				});
			}
		});

		await page.goto('/analytics');

		// Click Fuel & Stats tab
		await page.getByRole('tab', { name: /Fuel & Stats/i }).click();
		await expect(page.getByText('Fillups')).toBeVisible();

		// Click Cross-Vehicle tab
		await page.getByRole('tab', { name: /Cross-Vehicle/i }).click();
		// Wait for tab content to load
		await page.waitForTimeout(500);

		// Click Year-End Summary tab
		await page.getByRole('tab', { name: /Year-End Summary/i }).click();
		await expect(page.getByText('Select Year')).toBeVisible();
	});

	test('should handle empty state when no vehicles exist', async ({ page }) => {
		await page.route('**/api/v1/analytics/quick-stats*', async route => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					data: {
						vehicleCount: 0,
						ytdSpending: 0,
						avgMpg: null,
						fleetHealthScore: 0
					}
				})
			});
		});

		await page.route('**/api/v1/vehicles', async route => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true, data: [] })
			});
		});

		await page.goto('/analytics');

		// Quick stats should show zeros
		await expect(page.getByText('0', { exact: true })).toBeVisible();

		// Per-Vehicle tab should show empty state
		await page.getByRole('tab', { name: /Per-Vehicle/i }).click();
		await expect(page.getByText(/No vehicles found/i)).toBeVisible();
	});

	test('should handle API errors gracefully', async ({ page }) => {
		await page.route('**/api/v1/analytics/quick-stats*', async route => {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ success: false, error: { message: 'Server error' } })
			});
		});

		await page.goto('/analytics');

		// Should show error message with retry button
		await expect(page.getByText(/Failed to load/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /Retry/i })).toBeVisible();
	});
});
