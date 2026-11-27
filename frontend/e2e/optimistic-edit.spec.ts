import { test, expect, type Locator, type Page } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

async function holdPut(page: Page, answer: 'ok' | 'fail') {
	const state = { answered: false, sent: 0 };
	await page.route(
		url => url.pathname === '/api/v1/expenses/expense-maint',
		async route => {
			if (route.request().method() !== 'PUT') return route.fallback();
			state.sent++;
			await new Promise(resolve => setTimeout(resolve, 2000));
			state.answered = true;
			if (answer === 'ok') return route.fallback();
			return route.fulfill({
				status: 500,
				json: { success: false, message: 'Database unavailable' }
			});
		}
	);
	return state;
}

async function isOnTop(page: Page, target: Locator) {
	const box = await target.boundingBox();
	if (!box) return false;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	return target.evaluate(
		(el, [px, py]) => el.contains(document.elementFromPoint(px!, py!)),
		[x, y]
	);
}

async function editOilChangeAmount(page: Page, viewport = { width: 1280, height: 800 }) {
	await page.setViewportSize(viewport);
	await page.goto('/expenses/expense-maint/edit?returnTo=/expenses');
	await page.getByLabel('Amount *').fill('120.00');
	await page.getByRole('button', { name: 'Save changes' }).click();
}

test.describe('Editing an expense does not wait for the server', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('with a 2 s PUT, the list shows the new amount before the PUT answers', async ({ page }) => {
		const put = await holdPut(page, 'ok');

		await editOilChangeAmount(page);

		await expect(page).toHaveURL(/\/expenses$/);
		const row = page.getByTestId('expense-row').filter({ hasText: 'Oil change' });
		await expect(row.getByText('$120.00')).toBeVisible();
		expect(put.answered).toBe(false);
	});

	test('a failed PUT puts the saved amount back with the reason, Retry and Edit', async ({
		page
	}) => {
		const put = await holdPut(page, 'fail');

		await editOilChangeAmount(page);

		const row = page.getByTestId('expense-row').filter({ hasText: 'Oil change' });
		await expect(row.getByText('$120.00')).toBeVisible();
		await expect(row.getByText(/^Changes not saved:/)).toBeVisible({ timeout: 10_000 });
		await expect(row.getByText('$89.99')).toBeVisible();
		await expect(row.getByRole('link', { name: /^Edit / })).toBeVisible();
		await expect(page.getByText("Your changes to the expense weren't saved")).toHaveCount(1);

		await row.getByRole('button', { name: /^Retry saving changes/ }).click();
		await expect.poll(() => put.sent).toBe(2);
	});

	test('at 375, the Add button covers neither Retry nor Edit on a failed row, even at the end of the list', async ({
		page
	}) => {
		await holdPut(page, 'fail');

		await editOilChangeAmount(page, { width: 375, height: 600 });

		const row = page.getByTestId('expense-row').filter({ hasText: 'Oil change' });
		await expect(row.getByText(/^Changes not saved:/)).toBeVisible({ timeout: 10_000 });
		await expect(page.getByTestId('expense-row').last()).toContainText('Oil change');
		await page.getByRole('button', { name: 'Close toast' }).click();
		await expect(page.getByText("Your changes to the expense weren't saved")).toHaveCount(0);
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

		const add = page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Add expense' });
		const addTop = (await add.locator('span').first().boundingBox())!.y;
		const pageEnd = (await page.locator('#main > div > :last-child').last().boundingBox())!;
		expect(pageEnd.y + pageEnd.height).toBeLessThanOrEqual(addTop);

		expect(await isOnTop(page, row.getByRole('link', { name: /^Edit / }))).toBe(true);
		expect(await isOnTop(page, row.getByRole('button', { name: /^Retry saving changes/ }))).toBe(
			true
		);
	});
});
