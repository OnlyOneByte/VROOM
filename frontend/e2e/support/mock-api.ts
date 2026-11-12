import type { BrowserContext, Page, Route } from '@playwright/test';

export const E2E_USER = {
	id: 'e2e-user-1',
	email: 'e2e@example.com',
	displayName: 'E2E User'
};

export const SESSION_COOKIE = {
	name: 'auth_session',
	value: 'e2e-session-token',
	domain: 'localhost',
	path: '/',
	httpOnly: true,
	secure: false,
	sameSite: 'Lax' as const
};

export async function addSessionCookie(context: BrowserContext) {
	await context.addCookies([SESSION_COOKIE]);
}

const UNITS = { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' };

export const VEHICLE_CAMRY = {
	id: 'vehicle-camry',
	userId: E2E_USER.id,
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'car',
	trackFuel: true,
	trackCharging: false,
	licensePlate: 'ABC123',
	nickname: 'Daily Driver',
	initialMileage: 40000,
	createdAt: '2024-01-01T12:00:00.000Z',
	updatedAt: '2024-01-01T12:00:00.000Z'
};

export const VEHICLE_CIVIC = {
	id: 'vehicle-civic',
	userId: E2E_USER.id,
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	vehicleType: 'car',
	trackFuel: true,
	trackCharging: false,
	licensePlate: 'XYZ789',
	createdAt: '2024-01-01T12:00:00.000Z',
	updatedAt: '2024-01-01T12:00:00.000Z'
};

export const BACKEND_EXPENSES = [
	{
		id: 'expense-fuel',
		vehicleId: VEHICLE_CAMRY.id,
		userId: E2E_USER.id,
		category: 'fuel',
		expenseAmount: 45.5,
		date: '2024-03-15T12:00:00.000Z',
		volume: 12.5,
		mileage: 45000,
		fuelType: 'regular',
		description: 'Costco fill-up',
		tags: [],
		createdAt: '2024-03-15T12:00:00.000Z',
		updatedAt: '2024-03-15T12:00:00.000Z'
	},
	{
		id: 'expense-maint',
		vehicleId: VEHICLE_CAMRY.id,
		userId: E2E_USER.id,
		category: 'maintenance',
		expenseAmount: 89.99,
		date: '2024-03-10T12:00:00.000Z',
		description: 'Oil change',
		tags: [],
		createdAt: '2024-03-10T12:00:00.000Z',
		updatedAt: '2024-03-10T12:00:00.000Z'
	}
];

const EXPENSE_SUMMARY = {
	totalAmount: 135.49,
	expenseCount: 2,
	monthlyAverage: 135.49,
	recentAmount: 135.49,
	categoryBreakdown: [
		{ category: 'fuel', amount: 45.5, count: 1 },
		{ category: 'maintenance', amount: 89.99, count: 1 }
	],
	monthlyTrend: [{ period: '2024-03', amount: 135.49, count: 2 }]
};

const SETTINGS = {
	id: 'settings-1',
	userId: E2E_USER.id,
	unitPreferences: UNITS,
	currencyUnit: 'USD',
	autoBackupEnabled: false,
	backupFrequency: 'weekly',
	createdAt: '2024-01-01T12:00:00.000Z',
	updatedAt: '2024-01-01T12:00:00.000Z'
};

export const ANALYTICS_SUMMARY = {
	quickStats: {
		vehicleCount: 2,
		ytdSpending: 5000,
		avgEfficiency: 28.5,
		fleetHealthScore: 85,
		units: UNITS
	},
	fuelStats: {
		fillups: { currentYear: 10, previousYear: 8, currentMonth: 2, previousMonth: 1 },
		volume: { currentYear: 100, previousYear: 80, currentMonth: 20, previousMonth: 10 },
		fuelConsumption: { avgEfficiency: 30, bestEfficiency: 35, worstEfficiency: 25 },
		fillupDetails: { avgVolume: 10, minVolume: 8, maxVolume: 12 },
		averageCost: {
			perFillup: 50,
			bestCostPerDistance: 0.15,
			worstCostPerDistance: 0.25,
			avgCostPerDay: 5
		},
		distance: { totalDistance: 3000, avgPerDay: 10, avgPerMonth: 300 },
		monthlyConsumption: [],
		gasPriceHistory: [],
		fillupCostByVehicle: [],
		odometerProgression: [],
		costPerDistance: [],
		units: UNITS
	},
	fuelAdvanced: {
		maintenanceTimeline: [],
		seasonalEfficiency: [],
		vehicleRadar: [],
		dayOfWeekPatterns: [],
		monthlyCostHeatmap: [],
		fillupIntervals: []
	}
};

export async function fulfillData(route: Route, data: unknown, status = 200) {
	await route.fulfill({
		status,
		contentType: 'application/json',
		body: JSON.stringify({ success: true, data })
	});
}

export async function fulfillPage(route: Route, rows: unknown[]) {
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({
			success: true,
			data: rows,
			pagination: { totalCount: rows.length, limit: 50, offset: 0, hasMore: false }
		})
	});
}

export async function fulfillError(route: Route, status: number, message: string) {
	await route.fulfill({
		status,
		contentType: 'application/json',
		body: JSON.stringify({ success: false, error: { message } })
	});
}

export interface MockApiOptions {
	authenticated?: boolean;
	vehicles?: unknown[];
	expenses?: unknown[];
}

export async function mockApi(page: Page, options: MockApiOptions = {}) {
	const {
		authenticated = true,
		vehicles = [VEHICLE_CAMRY, VEHICLE_CIVIC],
		expenses = BACKEND_EXPENSES
	} = options;

	// Playwright runs route handlers in reverse registration order, so specs override these defaults by calling page.route() after mockApi().
	await page.route('**/api/v1/**', async route => {
		const request = route.request();
		const method = request.method();
		const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');

		if (path === '/auth/me') {
			if (!authenticated) return fulfillError(route, 401, 'Not authenticated');
			if (method === 'PATCH') return fulfillData(route, { user: E2E_USER });
			return fulfillData(route, {
				user: E2E_USER,
				session: { id: 'e2e-session', expiresAt: '2099-01-01T00:00:00.000Z' }
			});
		}
		if (path === '/auth/providers') {
			return fulfillData(route, [
				{ id: 'google', displayName: 'Google' },
				{ id: 'github', displayName: 'GitHub' }
			]);
		}
		if (path === '/auth/accounts') return fulfillData(route, []);
		if (path === '/auth/logout') return fulfillData(route, { success: true });

		if (path === '/settings') return fulfillData(route, SETTINGS);

		if (path === '/vehicles') {
			if (method === 'POST') {
				const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
				return fulfillData(
					route,
					{
						id: 'vehicle-created',
						userId: E2E_USER.id,
						vehicleType: 'car',
						trackFuel: true,
						trackCharging: false,
						createdAt: '2024-01-01T12:00:00.000Z',
						updatedAt: '2024-01-01T12:00:00.000Z',
						...body
					},
					201
				);
			}
			return fulfillData(route, vehicles);
		}
		const vehicleId = /^\/vehicles\/([^/]+)$/.exec(path)?.[1];
		if (vehicleId) {
			const match = (vehicles as Array<{ id: string }>).find(v => v.id === vehicleId);
			return match
				? fulfillData(route, match)
				: fulfillError(route, 404, `No vehicle fixture for ${vehicleId}`);
		}

		if (path === '/expenses/summary') return fulfillData(route, EXPENSE_SUMMARY);
		if (path === '/expenses/vehicle-stats') {
			return fulfillData(
				route,
				(vehicles as Array<{ id: string }>).map(v => ({
					vehicleId: v.id,
					totalAmount: 135.49,
					recentAmount: 135.49,
					lastExpenseDate: '2024-03-15T12:00:00.000Z'
				}))
			);
		}
		if (path === '/expenses') {
			if (method === 'POST') {
				const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
				return fulfillData(
					route,
					{
						id: 'expense-created',
						userId: E2E_USER.id,
						tags: [],
						createdAt: '2024-03-20T12:00:00.000Z',
						updatedAt: '2024-03-20T12:00:00.000Z',
						...body
					},
					201
				);
			}
			return fulfillPage(route, expenses);
		}
		const expenseId = /^\/expenses\/([^/]+)$/.exec(path)?.[1];
		if (expenseId) {
			if (method === 'DELETE') return fulfillData(route, { success: true });
			const match = (expenses as Array<{ id: string }>).find(e => e.id === expenseId);
			return match
				? fulfillData(route, match)
				: fulfillError(route, 404, `No expense fixture for ${expenseId}`);
		}

		if (path === '/photos') return fulfillData(route, {});
		if (/^\/photos\/[^/]+\/[^/]+$/.test(path)) return fulfillPage(route, []);

		if (path === '/insurance') return fulfillData(route, []);

		if (path === '/trips/summary') {
			return fulfillData(route, {
				tripCount: 0,
				totalMiles: 0,
				milesByPurpose: { business: 0, personal: 0, commute: 0, other: 0 },
				averageTripMiles: 0,
				businessMiles: 0,
				businessMileageValue: 0,
				rate: 0.67
			});
		}
		if (path === '/trips') return fulfillPage(route, []);

		if (path === '/reminders/recurring-cost') {
			return fulfillData(route, { count: 0, monthlyTotal: 0 });
		}
		if (path === '/reminders/notifications') return fulfillData(route, []);
		if (path === '/reminders/trigger') {
			return fulfillData(route, { triggered: 0, expensesCreated: 0, results: [] });
		}
		if (path === '/reminders') return fulfillData(route, []);

		if (path === '/shares/received' || path === '/shares/granted') {
			return fulfillData(route, []);
		}

		if (path === '/sync/status') {
			return fulfillData(route, { lastSyncDate: null, pendingChanges: false });
		}

		if (path === '/analytics/summary') return fulfillData(route, ANALYTICS_SUMMARY);
		if (path === '/analytics/fuel-stats') {
			return fulfillData(route, ANALYTICS_SUMMARY.fuelStats);
		}
		if (path === '/analytics/fuel-advanced') {
			return fulfillData(route, ANALYTICS_SUMMARY.fuelAdvanced);
		}

		return fulfillError(route, 404, `No E2E mock for ${method} /api/v1${path}`);
	});
}
