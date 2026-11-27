import { type Page, expect, test } from '@playwright/test';
import {
	E2E_USER,
	VEHICLE_CAMRY,
	addSessionCookie,
	fulfillData,
	fulfillError,
	fulfillPage,
	mockApi
} from './support/mock-api';

const BUSINESS_MILES = 100;

const TRIP = {
	id: 'trip-1',
	vehicleId: VEHICLE_CAMRY.id,
	startOdometer: 1000,
	endOdometer: 1000 + BUSINESS_MILES,
	purpose: 'business',
	tripDate: '2026-11-10',
	startLocation: null,
	endLocation: null,
	note: null,
	createdAt: '2026-11-10T12:00:00.000Z',
	updatedAt: '2026-11-10T12:00:00.000Z'
};

async function mockRateFlow(page: Page, { demo = false } = {}) {
	await mockApi(page);
	let rate = 0;
	const settings = () => ({
		id: 'settings-1',
		userId: E2E_USER.id,
		unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
		currencyUnit: 'USD',
		businessMileageRate: rate,
		autoBackupEnabled: false,
		backupFrequency: 'weekly',
		createdAt: '2024-01-01T12:00:00.000Z',
		updatedAt: '2024-01-01T12:00:00.000Z'
	});
	await page.route(
		url => url.pathname === '/api/v1/settings',
		async route => {
			if (route.request().method() === 'PUT') {
				if (demo) {
					return fulfillError(route, 403, "This is a demo garage, so changes aren't saved");
				}
				const body = route.request().postDataJSON() as { businessMileageRate?: number };
				if (typeof body.businessMileageRate === 'number') rate = body.businessMileageRate;
			}
			return fulfillData(route, settings());
		}
	);
	await page.route(
		url => url.pathname === '/api/v1/trips/summary',
		route =>
			fulfillData(route, {
				tripCount: 1,
				totalDistance: BUSINESS_MILES,
				distanceByPurpose: { business: BUSINESS_MILES, personal: 0, commute: 0, other: 0 },
				averageTripDistance: BUSINESS_MILES,
				businessDistance: BUSINESS_MILES,
				businessMileageValue: BUSINESS_MILES * rate,
				rate
			})
	);
	await page.route(
		url => url.pathname === '/api/v1/trips',
		route => fulfillPage(route, [TRIP])
	);
	if (demo) {
		await page.route(
			url => url.pathname === '/api/v1/auth/me',
			route =>
				fulfillData(route, {
					user: { ...E2E_USER, demo: true },
					session: { id: 'e2e-session', expiresAt: '2099-01-01T00:00:00.000Z' }
				})
		);
	}
}

const rateField = (page: Page) => page.getByRole('textbox', { name: 'Business mileage rate' });

test.describe('Business mileage rate', () => {
	test.beforeEach(async ({ context }) => {
		await addSessionCookie(context);
	});

	test('Trips links to the rate, and setting it shows the business mileage value', async ({
		page
	}) => {
		await mockRateFlow(page);
		await page.goto('/trips');

		const summary = page.getByTestId('trip-summary-card');
		await expect(summary.getByText('Business distance')).toBeVisible();
		await summary.getByRole('link', { name: 'Set a mileage rate to see what it’s worth' }).click();

		await expect(page).toHaveURL(/\/settings#business-mileage-rate$/);
		await expect(rateField(page)).toBeFocused();
		await rateField(page).fill('0.67');
		await rateField(page).press('Enter');
		await expect(page.getByText('Mileage rate saved')).toBeVisible();

		await page.goto('/trips');
		await expect(summary.getByText('Business mileage value')).toBeVisible();
		await expect(summary).toContainText('$67.00');
		await expect(summary).toContainText('at $0.67/mi');
		await expect(summary.getByRole('link', { name: /Set a mileage rate/ })).toHaveCount(0);
	});

	test('in the demo garage the rate is not saved, says why, and the field goes back', async ({
		page
	}) => {
		await mockRateFlow(page, { demo: true });
		await page.goto('/settings');

		await rateField(page).fill('0.5');
		await rateField(page).press('Tab');

		await expect(page.getByText(/This is a demo garage, so changes aren.t saved/)).toBeVisible();
		await expect(rateField(page)).toHaveValue('');
	});
});
