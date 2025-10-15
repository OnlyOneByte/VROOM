import { test, expect } from '@playwright/test';

/**
 * PWA Functionality E2E Tests
 * Tests Progressive Web App capabilities and offline functionality
 * Requirements: 1.1, 1.2, 1.4
 */

test.describe('PWA Functionality', () => {
	test('should have valid PWA manifest', async ({ page }) => {
		await page.goto('/');
		
		// Check for manifest link
		const manifestLink = page.locator('link[rel="manifest"]');
		await expect(manifestLink).toHaveCount(1);
		
		// Fetch and validate manifest
		const manifestHref = await manifestLink.getAttribute('href');
		const manifestResponse = await page.request.get(manifestHref || '/manifest.webmanifest');
		expect(manifestResponse.ok()).toBeTruthy();
		
		const manifest = await manifestResponse.json();
		expect(manifest.name).toBeTruthy();
		expect(manifest.short_name).toBeTruthy();
		expect(manifest.start_url).toBeTruthy();
		expect(manifest.display).toBe('standalone');
	});

	test('should register service worker', async ({ page }) => {
		await page.goto('/');
		
		// Wait for service worker registration
		const swRegistered = await page.evaluate(async () => {
			if ('serviceWorker' in navigator) {
				try {
					const registration = await navigator.serviceWorker.ready;
					return !!registration;
				} catch (e) {
					return false;
				}
			}
			return false;
		});
		
		expect(swRegistered).toBeTruthy();
	});

	test('should have proper meta tags for PWA', async ({ page }) => {
		await page.goto('/');
		
		// Check for theme color
		const themeColor = page.locator('meta[name="theme-color"]');
		await expect(themeColor).toHaveCount(1);
		
		// Check for viewport meta tag
		const viewport = page.locator('meta[name="viewport"]');
		await expect(viewport).toHaveCount(1);
		await expect(viewport).toHaveAttribute('content', /width=device-width/);
	});

	test('should have app icons defined', async ({ page }) => {
		await page.goto('/');
		
		// Check for apple touch icon
		const appleTouchIcon = page.locator('link[rel="apple-touch-icon"]');
		const iconCount = await appleTouchIcon.count();
		
		// Should have at least one icon defined (either apple-touch-icon or in manifest)
		if (iconCount === 0) {
			// Check manifest for icons
			const manifestLink = page.locator('link[rel="manifest"]');
			const manifestHref = await manifestLink.getAttribute('href');
			const manifestResponse = await page.request.get(manifestHref || '/manifest.webmanifest');
			const manifest = await manifestResponse.json();
			
			expect(manifest.icons).toBeTruthy();
			expect(manifest.icons.length).toBeGreaterThan(0);
		}
	});

	test('should cache static assets for offline use', async ({ page, context }) => {
		// Enable offline mode
		await context.route('**/*', (route) => {
			// Allow initial page load
			if (route.request().url().includes('localhost')) {
				route.continue();
			}
		});

		await page.goto('/');
		
		// Wait for service worker to cache assets
		await page.waitForTimeout(2000);
		
		// Check if service worker has cached resources
		const cacheExists = await page.evaluate(async () => {
			if ('caches' in window) {
				const cacheNames = await caches.keys();
				return cacheNames.length > 0;
			}
			return false;
		});
		
		expect(cacheExists).toBeTruthy();
	});

	test('should show offline indicator when network is unavailable', async ({ page, context }) => {
		await page.goto('/');
		
		// Simulate offline mode
		await context.setOffline(true);
		
		// Trigger a network request to detect offline state
		await page.evaluate(() => {
			window.dispatchEvent(new Event('offline'));
		});
		
		// Should show offline indicator
		await expect(page.getByText(/offline|no connection/i)).toBeVisible({ timeout: 5000 });
	});

	test('should allow offline expense entry', async ({ page, context }) => {
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

		await page.route('**/api/vehicles', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						id: 'vehicle1',
						make: 'Toyota',
						model: 'Camry',
						year: 2020
					}
				])
			});
		});

		await page.goto('/vehicles/vehicle1/expenses/new');
		
		// Go offline
		await context.setOffline(true);
		
		// Fill in expense form
		await page.getByLabel(/type/i).selectOption('fuel');
		await page.getByLabel(/amount/i).fill('45.50');
		await page.getByLabel(/date/i).fill('2024-01-15');
		
		// Submit form (should queue for later sync)
		const submitButton = page.getByRole('button', { name: /save|add|submit/i });
		await submitButton.click();
		
		// Should show offline message or queued message
		await expect(page.getByText(/offline|queued|will sync/i)).toBeVisible({ timeout: 5000 });
	});

	test('should sync offline data when back online', async ({ page, context }) => {
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

		await page.goto('/');
		
		// Simulate going offline and back online
		await context.setOffline(true);
		await page.evaluate(() => {
			window.dispatchEvent(new Event('offline'));
		});
		
		await page.waitForTimeout(1000);
		
		// Go back online
		await context.setOffline(false);
		await page.evaluate(() => {
			window.dispatchEvent(new Event('online'));
		});
		
		// Should show sync indicator or online status
		await expect(page.getByText(/online|syncing|connected/i)).toBeVisible({ timeout: 5000 });
	});
});

test.describe('Mobile Responsive Behavior', () => {
	test('should be responsive on mobile devices', async ({ page }) => {
		// Set mobile viewport
		await page.setViewportSize({ width: 375, height: 667 });
		
		await page.goto('/');
		
		// Page should render without horizontal scroll
		const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
		const viewportWidth = await page.evaluate(() => window.innerWidth);
		
		expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1); // Allow 1px tolerance
	});

	test('should have mobile-friendly navigation', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		
		await page.goto('/');
		
		// Should have hamburger menu or mobile navigation
		const mobileNav = page.locator('button[aria-label*="menu"], button[aria-label*="navigation"]');
		const navCount = await mobileNav.count();
		
		// Either mobile menu button exists or navigation is visible
		if (navCount > 0) {
			await expect(mobileNav.first()).toBeVisible();
		} else {
			// Check for visible navigation
			const nav = page.locator('nav');
			await expect(nav).toBeVisible();
		}
	});

	test('should have touch-friendly interactive elements', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		
		await page.goto('/');
		
		// Check that buttons are at least 44x44px (Apple's recommended touch target size)
		const buttons = page.locator('button');
		const buttonCount = await buttons.count();
		
		if (buttonCount > 0) {
			const firstButton = buttons.first();
			const box = await firstButton.boundingBox();
			
			if (box) {
				expect(box.height).toBeGreaterThanOrEqual(40); // Allow slight tolerance
			}
		}
	});

	test('should adapt layout for tablet devices', async ({ page }) => {
		// Set tablet viewport
		await page.setViewportSize({ width: 768, height: 1024 });
		
		await page.goto('/');
		
		// Page should render properly
		const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
		const viewportWidth = await page.evaluate(() => window.innerWidth);
		
		expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
	});
});
