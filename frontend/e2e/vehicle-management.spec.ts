import { test, expect } from '@playwright/test';

/**
 * Vehicle Management E2E Tests
 * Tests adding, viewing, and managing vehicles
 * Requirements: 2.1, 2.2, 2.3, 2.4
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
}

test.describe('Vehicle Management', () => {
	test.beforeEach(async ({ page, context }) => {
		await setupAuthenticatedSession(page, context);
	});

	test('should display empty state when no vehicles exist', async ({ page }) => {
		await page.route('**/api/vehicles', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([])
			});
		});

		await page.goto('/dashboard');
		
		// Should show empty state message
		await expect(page.getByText(/no vehicles|add your first vehicle/i)).toBeVisible();
		
		// Should show add vehicle button
		const addButton = page.getByRole('button', { name: /add vehicle/i });
		await expect(addButton).toBeVisible();
	});

	test('should display vehicle list with summary statistics', async ({ page }) => {
		await page.route('**/api/vehicles', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						id: 'vehicle1',
						make: 'Toyota',
						model: 'Camry',
						year: 2020,
						licensePlate: 'ABC123',
						nickname: 'Daily Driver'
					},
					{
						id: 'vehicle2',
						make: 'Honda',
						model: 'Civic',
						year: 2019,
						licensePlate: 'XYZ789'
					}
				])
			});
		});

		await page.goto('/dashboard');
		
		// Should display both vehicles
		await expect(page.getByText('Toyota Camry')).toBeVisible();
		await expect(page.getByText('Honda Civic')).toBeVisible();
		await expect(page.getByText('Daily Driver')).toBeVisible();
	});

	test('should open vehicle creation form', async ({ page }) => {
		await page.route('**/api/vehicles', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([])
			});
		});

		await page.goto('/dashboard');
		
		const addButton = page.getByRole('button', { name: /add vehicle/i });
		await addButton.click();
		
		// Should show vehicle form
		await expect(page.getByLabel(/make/i)).toBeVisible();
		await expect(page.getByLabel(/model/i)).toBeVisible();
		await expect(page.getByLabel(/year/i)).toBeVisible();
	});

	test('should validate required vehicle fields', async ({ page }) => {
		await page.route('**/api/vehicles', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([])
			});
		});

		await page.goto('/dashboard');
		
		const addButton = page.getByRole('button', { name: /add vehicle/i });
		await addButton.click();
		
		// Try to submit without filling required fields
		const submitButton = page.getByRole('button', { name: /save|add|create/i });
		await submitButton.click();
		
		// Should show validation errors
		await expect(page.getByText(/required|must be provided/i)).toBeVisible();
	});

	test('should successfully add a new vehicle', async ({ page }) => {
		await page.route('**/api/vehicles', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify([])
				});
			} else if (route.request().method() === 'POST') {
				const postData = route.request().postDataJSON();
				await route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify({
						id: 'new-vehicle-id',
						...postData
					})
				});
			}
		});

		await page.goto('/dashboard');
		
		const addButton = page.getByRole('button', { name: /add vehicle/i });
		await addButton.click();
		
		// Fill in vehicle details
		await page.getByLabel(/make/i).fill('Tesla');
		await page.getByLabel(/model/i).fill('Model 3');
		await page.getByLabel(/year/i).fill('2023');
		await page.getByLabel(/license plate/i).fill('TESLA1');
		
		// Submit form
		const submitButton = page.getByRole('button', { name: /save|add|create/i });
		await submitButton.click();
		
		// Should show success message
		await expect(page.getByText(/success|added|created/i)).toBeVisible();
	});

	test('should display vehicle with loan information', async ({ page }) => {
		await page.route('**/api/vehicles', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						id: 'vehicle1',
						make: 'Ford',
						model: 'F-150',
						year: 2022,
						purchasePrice: 45000,
						loan: {
							id: 'loan1',
							lender: 'Bank of America',
							originalAmount: 40000,
							currentBalance: 35000,
							apr: 4.5,
							termMonths: 60,
							standardPayment: {
								amount: 745.50,
								frequency: 'monthly'
							}
						}
					}
				])
			});
		});

		await page.goto('/dashboard');
		
		// Should display loan information
		await expect(page.getByText('Ford F-150')).toBeVisible();
		await expect(page.getByText(/loan|financing/i)).toBeVisible();
		await expect(page.getByText(/\$35,000|\$35000/)).toBeVisible(); // Current balance
	});

	test('should filter vehicles by selection', async ({ page }) => {
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
					},
					{
						id: 'vehicle2',
						make: 'Honda',
						model: 'Civic',
						year: 2019
					}
				])
			});
		});

		await page.goto('/dashboard');
		
		// Click on a specific vehicle
		await page.getByText('Toyota Camry').click();
		
		// Should filter to show only that vehicle's data
		await expect(page).toHaveURL(/vehicle1|vehicles\/vehicle1/);
	});
});
