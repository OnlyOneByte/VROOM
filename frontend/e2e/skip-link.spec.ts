import { test, expect } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('skip link', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('the first Tab shows "Skip to content", and Enter moves the next Tab past the rail', async ({
		page
	}) => {
		await page.goto('/dashboard');
		await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Skip to content' });
		await expect(skip).toBeFocused();
		await expect(skip).toBeInViewport();

		await page.keyboard.press('Enter');
		await expect(page.locator('main#main')).toBeFocused();

		await page.keyboard.press('Tab');
		const inMain = await page.evaluate(
			() => document.querySelector('main#main')?.contains(document.activeElement) ?? false
		);
		expect(inMain).toBe(true);
	});
});
