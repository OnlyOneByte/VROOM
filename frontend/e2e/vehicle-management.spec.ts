import { test, expect } from '@playwright/test';
import { VEHICLE_CAMRY, VEHICLE_CIVIC, addSessionCookie, mockApi } from './support/mock-api';

test.describe('Fleet overview', () => {
	test.beforeEach(async ({ context }) => {
		await addSessionCookie(context);
	});

	test('a fleet-less dashboard invites the first vehicle', async ({ page }) => {
		await mockApi(page, { vehicles: [], expenses: [] });

		await page.goto('/dashboard');

		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
		await expect(page.getByText(/Get started by adding your first vehicle/i)).toBeVisible();
		await expect(page.getByRole('link', { name: 'Add Vehicle' })).toBeVisible();
	});

	test('the dashboard lists the fleet and links each vehicle to its page', async ({ page }) => {
		await mockApi(page);

		await page.goto('/dashboard');

		const camryLink = page.getByRole('link', { name: VEHICLE_CAMRY.nickname });
		await expect(camryLink).toBeVisible();
		await expect(camryLink).toHaveAttribute('href', `/vehicles/${VEHICLE_CAMRY.id}`);
		await expect(page.getByText('2020 Toyota Camry')).toBeVisible();

		await expect(page.getByRole('link', { name: '2019 Honda Civic' })).toHaveAttribute(
			'href',
			`/vehicles/${VEHICLE_CIVIC.id}`
		);
	});

	test('a financed vehicle is badged as financed', async ({ page }) => {
		await mockApi(page, {
			vehicles: [
				{
					...VEHICLE_CAMRY,
					financing: {
						id: 'financing-1',
						vehicleId: VEHICLE_CAMRY.id,
						financingType: 'loan',
						provider: 'Example Credit Union',
						originalAmount: 40000,
						apr: 4.5,
						termMonths: 60,
						startDate: '2023-01-01T12:00:00.000Z',
						paymentAmount: 745.5,
						paymentFrequency: 'monthly',
						isActive: true,
						createdAt: '2023-01-01T12:00:00.000Z',
						updatedAt: '2023-01-01T12:00:00.000Z'
					}
				}
			]
		});

		await page.goto('/dashboard');

		await expect(page.getByText('Financed')).toBeVisible();
	});
});

test.describe('Adding a vehicle', () => {
	test.beforeEach(async ({ page, context }) => {
		await addSessionCookie(context);
		await mockApi(page, { vehicles: [], expenses: [] });
	});

	test('the create form is reachable from the dashboard', async ({ page }) => {
		await page.goto('/dashboard');

		await expect(async () => {
			if (!/\/vehicles\/new$/.test(page.url())) {
				await page.getByRole('link', { name: 'Add Vehicle' }).click();
			}
			expect(page.url()).toMatch(/\/vehicles\/new$/);
		}).toPass({ timeout: 20_000, intervals: [300, 1000, 2000] });

		await expect(page.getByRole('heading', { name: 'Add New Vehicle' })).toBeVisible();
		await expect(page.getByLabel('Make *')).toBeVisible();
		await expect(page.getByLabel('Model *')).toBeVisible();
		await expect(page.getByLabel('Year *')).toBeVisible();
	});

	test('submitting an empty form reports the missing required fields', async ({ page }) => {
		let posted = false;
		await page.route(
			url => url.pathname === '/api/v1/vehicles',
			async route => {
				if (route.request().method() === 'POST') posted = true;
				await route.fallback();
			}
		);

		await page.goto('/vehicles/new');
		await page.getByRole('button', { name: 'Add Vehicle' }).click();

		await expect(page.getByText('Make is required')).toBeVisible();
		await expect(page.getByText('Model is required')).toBeVisible();
		expect(posted).toBe(false);
	});

	test('a filled form POSTs the vehicle and returns to the dashboard', async ({ page }) => {
		await page.goto('/vehicles/new');

		await page.getByLabel('Make *').fill('Tesla');
		await page.getByLabel('Model *').fill('Model 3');
		await page.getByLabel('Year *').fill('2023');
		await page.getByLabel('License Plate').fill('TESLA1');

		const postRequest = page.waitForRequest(
			request =>
				new URL(request.url()).pathname === '/api/v1/vehicles' && request.method() === 'POST'
		);
		await page.getByRole('button', { name: 'Add Vehicle' }).click();

		const body = (await postRequest).postDataJSON();
		expect(body).toMatchObject({ make: 'Tesla', model: 'Model 3', year: 2023 });

		await expect(page.getByText('Vehicle added successfully!')).toBeVisible();
		await expect(page).toHaveURL(/\/dashboard$/);
	});
});
