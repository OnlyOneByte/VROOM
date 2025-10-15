import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 * Tests the Google OAuth login flow and session management
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

test.describe('Authentication Flow', () => {
	test('should display login page for unauthenticated users', async ({ page }) => {
		await page.goto('/');
		
		// Should redirect to login or show login option
		await expect(page).toHaveURL(/\/(login)?/);
		
		// Check for Google OAuth button
		const loginButton = page.getByRole('button', { name: /sign in with google/i });
		await expect(loginButton).toBeVisible();
	});

	test('should show Google OAuth button with correct attributes', async ({ page }) => {
		await page.goto('/login');
		
		const googleButton = page.getByRole('button', { name: /sign in with google/i });
		await expect(googleButton).toBeVisible();
		await expect(googleButton).toBeEnabled();
	});

	test('should handle OAuth redirect flow', async ({ page }) => {
		await page.goto('/login');
		
		// Click Google OAuth button
		const googleButton = page.getByRole('button', { name: /sign in with google/i });
		
		// Mock OAuth flow by intercepting the redirect
		await page.route('**/auth/login/google', async (route) => {
			// Simulate successful OAuth callback
			await route.fulfill({
				status: 302,
				headers: {
					'Location': '/auth/callback/google?code=mock_auth_code&state=mock_state'
				}
			});
		});
		
		await googleButton.click();
		
		// Should attempt to redirect to Google OAuth
		await page.waitForURL(/auth\/login\/google|accounts\.google\.com/);
	});

	test('should protect routes requiring authentication', async ({ page }) => {
		// Try to access protected route without authentication
		await page.goto('/dashboard');
		
		// Should redirect to login
		await expect(page).toHaveURL(/login/);
	});

	test('should display user profile after successful login', async ({ page, context }) => {
		// Mock authenticated session
		await context.addCookies([
			{
				name: 'auth_session',
				value: 'mock_session_token',
				domain: 'localhost',
				path: '/',
				httpOnly: true,
				secure: false,
				sameSite: 'Lax'
			}
		]);

		// Mock API response for user info
		await page.route('**/api/auth/me', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'user123',
					email: 'test@example.com',
					displayName: 'Test User',
					provider: 'google'
				})
			});
		});

		await page.goto('/dashboard');
		
		// Should show user profile
		await expect(page.getByText('Test User')).toBeVisible();
	});

	test('should handle logout successfully', async ({ page, context }) => {
		// Set up authenticated session
		await context.addCookies([
			{
				name: 'auth_session',
				value: 'mock_session_token',
				domain: 'localhost',
				path: '/',
				httpOnly: true,
				secure: false,
				sameSite: 'Lax'
			}
		]);

		await page.route('**/api/auth/me', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'user123',
					email: 'test@example.com',
					displayName: 'Test User'
				})
			});
		});

		await page.goto('/dashboard');

		// Mock logout endpoint
		await page.route('**/api/auth/logout', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ success: true })
			});
		});

		// Click logout button
		const logoutButton = page.getByRole('button', { name: /logout|sign out/i });
		await logoutButton.click();

		// Should redirect to login page
		await expect(page).toHaveURL(/login/);
	});
});
