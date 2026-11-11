import { test, expect, type Page } from '@playwright/test';
import { E2E_USER, addSessionCookie, mockApi } from './support/mock-api';

/**
 * Sign-in, route protection and sign-out.
 *
 * Route facts this spec is written against (there is no `/login` route — the previous
 * version of this file navigated to one):
 *   `/`     — marketing landing page, public, has the "Sign In" affordance
 *   `/auth` — sign-in page; the provider buttons come from `GET /api/v1/auth/providers`,
 *             so the label is "Continue with <provider>", not "Sign in with Google"
 *   anything not in `publicRoutes` ($lib/utils/auth.ts) redirects a logged-out visitor
 *             to `/auth`
 */

/** Sign out lives in the desktop sidebar, and on narrow viewports inside the mobile
 *  navigation sheet — which is not in the DOM until the hamburger is clicked. */
async function openNavigationForNarrowViewports(page: Page) {
	const hamburger = page.getByRole('button', { name: 'Open navigation menu' });
	if (await hamburger.isVisible()) {
		await hamburger.click();
	}
}

test.describe('Signed out', () => {
	test.beforeEach(async ({ page }) => {
		await mockApi(page, { authenticated: false });
	});

	test('landing page offers sign-in', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
	});

	test('sign-in page lists the providers the backend reports', async ({ page }) => {
		await page.goto('/auth');

		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
		await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeEnabled();
		await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeEnabled();
	});

	test('sign-in page reports a provider-fetch failure instead of an empty card', async ({
		page
	}) => {
		await page.route('**/api/v1/auth/providers', route =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ success: false, error: { message: 'boom' } })
			})
		);

		await page.goto('/auth');

		await expect(page.getByText(/Failed to load sign-in options/i)).toBeVisible();
	});

	test('choosing a provider hands off to the backend OAuth start endpoint', async ({ page }) => {
		// The real endpoint 302s to Google. Stub it so the test asserts the handoff without
		// leaving localhost.
		await page.route('**/api/v1/auth/login/google', route =>
			route.fulfill({ status: 200, contentType: 'text/html', body: '<html>provider</html>' })
		);

		await page.goto('/auth');
		await page.getByRole('button', { name: /Continue with Google/i }).click();

		await expect(page).toHaveURL(/\/api\/v1\/auth\/login\/google$/);
	});

	test('a protected route redirects to sign-in', async ({ page }) => {
		await page.goto('/dashboard');

		await expect(page).toHaveURL(/\/auth$/);
		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
	});
});

test.describe('Signed in', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page);
	});

	test('the landing page bounces a signed-in visitor to the dashboard', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveURL(/\/dashboard$/);
	});

	test('the profile page shows the signed-in identity', async ({ page }) => {
		await page.goto('/profile');

		await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
		await expect(page.getByText(E2E_USER.displayName).first()).toBeVisible();
		await expect(page.getByText(E2E_USER.email).first()).toBeVisible();
	});

	test('signing out calls the logout endpoint and returns to sign-in', async ({ page }) => {
		await page.goto('/dashboard');
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		const logoutRequest = page.waitForRequest(
			request => request.url().includes('/api/v1/auth/logout') && request.method() === 'POST'
		);

		await openNavigationForNarrowViewports(page);
		await page.getByRole('button', { name: 'Sign out' }).click();

		await logoutRequest;
		await expect(page).toHaveURL(/\/auth$/);
	});
});
