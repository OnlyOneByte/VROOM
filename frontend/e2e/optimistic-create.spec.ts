import { test, expect, type Page } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

async function addCarWash(page: Page): Promise<void> {
	await page.goto('/expenses/new');
	await page.getByRole('radio', { name: 'Misc' }).click();
	await page.getByLabel('Amount *').fill('12.34');
	await page.getByRole('button', { name: /More details/ }).click();
	await page.getByLabel('Description (Optional)').fill('Car wash on Elm');
	await page.getByRole('button', { name: 'Save Expense' }).click();
}

test.describe('Adding an expense does not wait for the server', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('with a slow server, the new row is on the list, marked Unsynced, before the save returns', async ({
		page
	}) => {
		let answered = false;
		await page.route(
			url => url.pathname === '/api/v1/expenses',
			async route => {
				if (route.request().method() !== 'POST') return route.fallback();
				await new Promise(resolve => setTimeout(resolve, 2000));
				answered = true;
				await route.fallback();
			}
		);

		await addCarWash(page);

		await expect(page).toHaveURL(/\/expenses$/);
		const row = page.getByTestId('expense-row').filter({ hasText: 'Car wash on Elm' });
		await expect(row).toBeVisible();
		await expect(row.getByText('Unsynced')).toBeVisible();
		expect(answered).toBe(false);
	});

	test('a refused save stays on its row with the reason, is announced, survives a reload, and Edit brings back what was typed', async ({
		page
	}) => {
		await page.route(
			url => url.pathname === '/api/v1/expenses',
			async route => {
				if (route.request().method() !== 'POST') return route.fallback();
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ success: false, message: 'That vehicle was archived' })
				});
			}
		);

		await addCarWash(page);

		const row = page.getByTestId('expense-row').filter({ hasText: 'Car wash on Elm' });
		await expect(row.getByText('Not saved: That vehicle was archived')).toBeVisible();
		await expect(page.getByText(/wasn't saved/)).toBeVisible();

		await page.reload();
		await expect(row.getByText(/Not saved:/)).toBeVisible();

		await row.getByRole('link', { name: /^Edit / }).click();
		await expect(page.getByLabel('Amount *')).toHaveValue('12.34');
		const description = page.getByLabel('Description (Optional)');
		if (!(await description.isVisible()))
			await page.getByRole('button', { name: /More details/ }).click();
		await expect(description).toHaveValue('Car wash on Elm');
		await expect(page.getByRole('radio', { name: 'Misc' })).toBeChecked();
	});
});
