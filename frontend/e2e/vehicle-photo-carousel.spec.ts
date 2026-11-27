import { test, expect, type Page } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

const CAROUSEL_CHUNK = /VehiclePhotoCarousel/;

async function openDetails(page: Page) {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto('/vehicles/vehicle-camry');
	await page.getByRole('button', { name: 'Details and photos' }).click();
}

test.describe("The vehicle page's photo carousel loads on its own", () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('a placeholder holds its place while the carousel code loads', async ({ page }) => {
		let release: () => void = () => {};
		const held = new Promise<void>(resolve => (release = resolve));
		await page.route(CAROUSEL_CHUNK, async route => {
			await held;
			return route.fallback();
		});

		await openDetails(page);

		const details = page.locator('[data-slot="collapsible-content"]');
		const photos = details.getByRole('heading', { name: 'Photos' });
		await expect(details.locator('[data-slot="skeleton"]').first()).toBeVisible();
		await expect(photos).toHaveCount(0);
		await expect(details.getByRole('alert')).toHaveCount(0);

		release();
		await expect(photos).toBeVisible();
	});

	test('a carousel chunk that fails to load says so instead of leaving a gap', async ({ page }) => {
		await page.route(CAROUSEL_CHUNK, route => route.abort());

		await openDetails(page);

		await expect(page.locator('[data-slot="collapsible-content"]').getByRole('alert')).toHaveText(
			"Photos couldn't be loaded. Check your connection and reload."
		);
	});
});
