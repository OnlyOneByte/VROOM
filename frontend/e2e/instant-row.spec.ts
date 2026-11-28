import { test, expect } from '@playwright/test';
import { addSessionCookie, mockApi } from './support/mock-api';

test.describe('A new expense shows on the list before the list has loaded', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('with the list fetch held open, the row is on screen and its time after Save is logged', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		let releaseList: () => void = () => {};
		const listHeld = new Promise<void>(resolve => (releaseList = resolve));
		await page.route(
			url => url.pathname === '/api/v1/expenses',
			async route => {
				if (route.request().method() === 'POST') {
					await new Promise(resolve => setTimeout(resolve, 2000));
					return route.fallback();
				}
				await listHeld;
				return route.fallback();
			}
		);

		await page.goto('/expenses/new');
		await page.getByRole('radio', { name: 'Misc' }).click();
		await page.getByLabel('Amount *').fill('12.34');
		await page.getByRole('button', { name: /More details/ }).click();
		await page.getByLabel('Description (optional)').fill('Car wash on Elm');

		await page.evaluate(() => {
			const save = [...document.querySelectorAll('button')].find(
				b => b.textContent?.trim() === 'Save expense'
			);
			save?.addEventListener('click', () => {
				const clickedAt = performance.now();
				const push = history.pushState.bind(history);
				history.pushState = (...args) => {
					(window as unknown as { navAfterMs: number }).navAfterMs = performance.now() - clickedAt;
					push(...args);
				};
				const seen = () =>
					[...document.querySelectorAll('[data-testid="pending-rows-while-loading"]')].some(el =>
						el.textContent?.includes('Car wash on Elm')
					);
				const observer = new MutationObserver(() => {
					if (!seen()) return;
					(window as unknown as { rowAfterMs: number }).rowAfterMs = performance.now() - clickedAt;
					observer.disconnect();
				});
				observer.observe(document.body, { childList: true, subtree: true, characterData: true });
			});
		});
		await page.getByRole('button', { name: 'Save expense' }).click();

		await expect(
			page.getByTestId('pending-rows-while-loading').getByText('Car wash on Elm')
		).toBeVisible();
		const ms = await page.evaluate(() => (window as unknown as { rowAfterMs: number }).rowAfterMs);
		const nav = await page.evaluate(() => (window as unknown as { navAfterMs: number }).navAfterMs);
		console.log(
			`row visible ${Math.round(ms)} ms after Save; URL changed at ${Math.round(nav)} ms`
		);
		expect(ms).toBeGreaterThan(0);

		releaseList();
		await expect(
			page.getByTestId('expense-row').filter({ hasText: 'Car wash on Elm' })
		).toBeVisible();
	});

	test('a save the server answers at once still shows on the list while the list is held', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		let releaseList: () => void = () => {};
		const listHeld = new Promise<void>(resolve => (releaseList = resolve));
		let saved = false;
		await page.route(
			url => url.pathname === '/api/v1/expenses',
			async route => {
				if (route.request().method() === 'POST') {
					saved = true;
					return route.fallback();
				}
				if (saved) await listHeld;
				return route.fallback();
			}
		);

		await page.goto('/expenses/new');
		await page.getByRole('radio', { name: 'Misc' }).click();
		await page.getByLabel('Amount *').fill('12.34');
		await page.getByRole('button', { name: /More details/ }).click();
		await page.getByLabel('Description (optional)').fill('Car wash on Elm');
		const reply = page.waitForResponse(
			response =>
				new URL(response.url()).pathname === '/api/v1/expenses' &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Save expense' }).click();

		expect((await reply).ok()).toBe(true);
		expect(saved).toBe(true);
		const early = page.getByTestId('pending-rows-while-loading');
		await expect(early.getByText('Car wash on Elm')).toBeVisible();

		releaseList();
		await expect(early).toHaveCount(0);
	});
});
