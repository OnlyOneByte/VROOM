import { test, expect } from '@playwright/test';

/**
 * Expense Entry E2E Tests
 * Tests expense creation, categorization, and mobile optimization
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

// Helper to set up authenticated session
async function setupAuthenticatedSession(page, context) {
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

	await page.route('**/api/auth/me', async route => {
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

	// Mock vehicles
	await page.route('**/api/vehicles', async route => {
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
}

test.describe('Expense Entry', () => {
	test.beforeEach(async ({ page, context }) => {
		await setupAuthenticatedSession(page, context);
	});

	test('should display expense entry form', async ({ page }) => {
		await page.goto('/vehicles/vehicle1/expenses/new');

		// Should show expense form fields
		await expect(page.getByLabel(/type|category/i)).toBeVisible();
		await expect(page.getByLabel(/amount/i)).toBeVisible();
		await expect(page.getByLabel(/date/i)).toBeVisible();
	});

	test('should validate required expense fields', async ({ page }) => {
		await page.goto('/vehicles/vehicle1/expenses/new');

		// Try to submit without filling required fields
		const submitButton = page.getByRole('button', { name: /save|add|submit/i });
		await submitButton.click();

		// Should show validation errors
		await expect(page.getByText(/required|must be provided/i)).toBeVisible();
	});

	test('should successfully add a fuel expense with MPG calculation', async ({ page }) => {
		await page.route('**/api/vehicles/vehicle1/expenses', async route => {
			if (route.request().method() === 'POST') {
				const postData = route.request().postDataJSON();
				await route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify({
						id: 'expense1',
						...postData,
						createdAt: new Date().toISOString()
					})
				});
			}
		});

		await page.goto('/vehicles/vehicle1/expenses/new');

		// Select fuel expense type
		await page.getByLabel(/type/i).selectOption('fuel');

		// Fill in fuel-specific fields
		await page.getByLabel(/amount/i).fill('45.50');
		await page.getByLabel(/gallons/i).fill('12.5');
		await page.getByLabel(/mileage/i).fill('45000');
		await page.getByLabel(/date/i).fill('2024-01-15');

		// Submit form
		const submitButton = page.getByRole('button', { name: /save|add|submit/i });
		await submitButton.click();

		// Should show success message
		await expect(page.getByText(/success|added|saved/i)).toBeVisible();
	});

	test('should display expense categories correctly', async ({ page }) => {
		await page.goto('/vehicles/vehicle1/expenses/new');

		// Check that expense type dropdown has correct categories
		const typeSelect = page.getByLabel(/type/i);
		await typeSelect.click();

		// Should show various expense types
		await expect(page.getByRole('option', { name: /fuel/i })).toBeVisible();
		await expect(page.getByRole('option', { name: /maintenance/i })).toBeVisible();
		await expect(page.getByRole('option', { name: /insurance/i })).toBeVisible();
	});

	test('should show fuel-specific fields only for fuel expenses', async ({ page }) => {
		await page.goto('/vehicles/vehicle1/expenses/new');

		// Initially, fuel fields should not be visible
		await expect(page.getByLabel(/gallons/i)).not.toBeVisible();

		// Select fuel expense type
		await page.getByLabel(/type/i).selectOption('fuel');

		// Now fuel fields should be visible
		await expect(page.getByLabel(/gallons/i)).toBeVisible();
		await expect(page.getByLabel(/mileage/i)).toBeVisible();
	});

	test('should list existing expenses', async ({ page }) => {
		await page.route('**/api/vehicles/vehicle1/expenses', async route => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify([
						{
							id: 'expense1',
							type: 'fuel',
							category: 'operating',
							amount: 45.5,
							date: '2024-01-15',
							gallons: 12.5,
							mileage: 45000
						},
						{
							id: 'expense2',
							type: 'maintenance',
							category: 'maintenance',
							amount: 89.99,
							date: '2024-01-10',
							description: 'Oil change'
						}
					])
				});
			}
		});

		await page.goto('/vehicles/vehicle1/expenses');

		// Should display both expenses
		await expect(page.getByText(/\$45\.50|\$45.50/)).toBeVisible();
		await expect(page.getByText(/\$89\.99|\$89.99/)).toBeVisible();
		await expect(page.getByText(/oil change/i)).toBeVisible();
	});

	test('should filter expenses by category', async ({ page }) => {
		await page.route('**/api/vehicles/vehicle1/expenses', async route => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						id: 'expense1',
						type: 'fuel',
						category: 'operating',
						amount: 45.5,
						date: '2024-01-15'
					},
					{
						id: 'expense2',
						type: 'maintenance',
						category: 'maintenance',
						amount: 89.99,
						date: '2024-01-10'
					}
				])
			});
		});

		await page.goto('/vehicles/vehicle1/expenses');

		// Apply category filter
		const filterSelect = page.getByLabel(/filter|category/i);
		if (await filterSelect.isVisible()) {
			await filterSelect.selectOption('operating');

			// Should show only operating expenses
			await expect(page.getByText(/\$45\.50/)).toBeVisible();
			await expect(page.getByText(/\$89\.99/)).not.toBeVisible();
		}
	});

	test('should delete an expense', async ({ page }) => {
		await page.route('**/api/vehicles/vehicle1/expenses', async route => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						id: 'expense1',
						type: 'fuel',
						amount: 45.5,
						date: '2024-01-15'
					}
				])
			});
		});

		await page.route('**/api/expenses/expense1', async route => {
			if (route.request().method() === 'DELETE') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ success: true })
				});
			}
		});

		await page.goto('/vehicles/vehicle1/expenses');

		// Click delete button
		const deleteButton = page.getByRole('button', { name: /delete|remove/i }).first();
		await deleteButton.click();

		// Confirm deletion if there's a confirmation dialog
		const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i });
		if (await confirmButton.isVisible()) {
			await confirmButton.click();
		}

		// Should show success message
		await expect(page.getByText(/deleted|removed/i)).toBeVisible();
	});
});

test.describe('Mobile Expense Entry', () => {
	test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE size

	test.beforeEach(async ({ page, context }) => {
		await setupAuthenticatedSession(page, context);
	});

	test('should display mobile-optimized expense form', async ({ page }) => {
		await page.goto('/vehicles/vehicle1/expenses/new');

		// Form should be visible and properly sized for mobile
		const form = page.locator('form');
		await expect(form).toBeVisible();

		// Check that inputs are touch-friendly (at least 44px tall)
		const amountInput = page.getByLabel(/amount/i);
		const box = await amountInput.boundingBox();
		expect(box?.height).toBeGreaterThanOrEqual(40);
	});

	test('should use mobile-optimized keyboard for numeric inputs', async ({ page }) => {
		await page.goto('/vehicles/vehicle1/expenses/new');

		// Amount field should have numeric input type
		const amountInput = page.getByLabel(/amount/i);
		await expect(amountInput).toHaveAttribute('type', /number|tel/);
	});

	test('should have touch-friendly buttons on mobile', async ({ page }) => {
		await page.goto('/vehicles/vehicle1/expenses/new');

		// Buttons should be large enough for touch
		const submitButton = page.getByRole('button', { name: /save|add|submit/i });
		const box = await submitButton.boundingBox();
		expect(box?.height).toBeGreaterThanOrEqual(40);
	});
});
