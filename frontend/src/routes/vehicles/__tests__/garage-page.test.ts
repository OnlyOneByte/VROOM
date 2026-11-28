import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import type { ExpenseSummary, ReceivedShare, Vehicle, VehicleStats } from '#lib/types/index.ts';
import type { AnalyticsQueryResponse } from '#lib/types/analytics.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({
	resolve: (path: string, params?: { id: string }) => path.replace('[id]', params?.id ?? '')
}));

const getVehicles = vi.fn<() => Promise<Vehicle[]>>();
const getVehicleStats = vi.fn<(id: string) => Promise<VehicleStats>>();
const getExpenseSummary = vi.fn<(params: { vehicleId?: string }) => Promise<ExpenseSummary>>();
const query = vi.fn<() => Promise<AnalyticsQueryResponse>>();
const listReceived = vi.fn<() => Promise<ReceivedShare[]>>();

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () => getVehicles(),
		getVehicleStats: (id: string) => getVehicleStats(id)
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { getExpenseSummary: (params: { vehicleId?: string }) => getExpenseSummary(params) }
}));
vi.mock('#lib/services/analytics-api.ts', () => ({ analyticsApi: { query: () => query() } }));
vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: { listReceived: () => listReceived(), accept: vi.fn(), decline: vi.fn() }
}));

import Page from '../+page.svelte';

const base = {
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
};
const CAMRY = {
	...base,
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	nickname: 'Daily Driver',
	licensePlate: 'ABC123'
} as Vehicle;
const TESLA = {
	...base,
	id: 'v2',
	make: 'Tesla',
	model: 'Model 3',
	year: 2023,
	vehicleType: 'electric'
} as Vehicle;
const LENT = {
	...base,
	id: 'v3',
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	sharedAccess: { sharedBy: 'Sam', permission: 'view' }
} as unknown as Vehicle;

function summary(byVehicle: Array<{ vehicleId: string; amount: number }>): ExpenseSummary {
	return {
		totalAmount: byVehicle.reduce((sum, row) => sum + row.amount, 0),
		categoryBreakdown: [],
		costBuckets: {
			byVehicle: byVehicle.map(row => ({
				vehicleId: row.vehicleId,
				ownershipTotal: 0,
				runningTotal: row.amount
			}))
		}
	} as unknown as ExpenseSummary;
}

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockResolvedValue([CAMRY, TESLA]);
	getExpenseSummary.mockResolvedValue(
		summary([
			{ vehicleId: 'v1', amount: 501.2 },
			{ vehicleId: 'v2', amount: 44 }
		])
	);
	query.mockResolvedValue({
		series: [{ key: 'v1', label: 'Daily Driver', values: [0.2] }]
	} as unknown as AnalyticsQueryResponse);
	getVehicleStats.mockImplementation(id =>
		Promise.resolve({ currentOdometer: id === 'v1' ? 40360 : null } as VehicleStats)
	);
	listReceived.mockResolvedValue([]);
});

describe('the Garage', () => {
	test('titles itself with the count and lists each owned car with its 30-day figures', async () => {
		render(Page);

		expect(
			await screen.findByRole('heading', { level: 1, name: '2 vehicles' })
		).toBeInTheDocument();
		const rows = within(screen.getByRole('list', { name: 'Your vehicles' })).getAllByRole(
			'listitem'
		);
		expect(rows).toHaveLength(2);

		const daily = within(rows[0]!);
		expect(daily.getByRole('link', { name: 'Daily Driver' })).toHaveAttribute(
			'href',
			'/vehicles/v1'
		);
		await waitFor(() =>
			expect(daily.getByText('2020 Toyota Camry · ABC123 · 40,360 mi')).toBeInTheDocument()
		);
		expect(daily.getByText('$501')).toBeInTheDocument();
		expect(rows[0]!.textContent).toMatch(/30 days ·\s*\$0\.20\/mi/);

		const tesla = within(rows[1]!);
		expect(tesla.getByRole('link', { name: '2023 Tesla Model 3' })).toBeInTheDocument();
		expect(tesla.getByText('electric')).toBeInTheDocument();
		expect(tesla.getByText('no running cost per mi')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Add vehicle/ })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
	});

	test('a car with no cost per mile gets one note under the list saying what fills it in', async () => {
		render(Page);
		expect(await screen.findByTestId('no-per-distance-note')).toHaveTextContent(
			'— means no cost per mi yet. It shows once there’s a newer odometer reading'
		);

		query.mockResolvedValue({
			series: [
				{ key: 'v1', label: 'Daily Driver', values: [0.2] },
				{ key: 'v2', label: 'Tesla', values: [0.05] }
			]
		} as unknown as AnalyticsQueryResponse);
		document.body.innerHTML = '';
		render(Page);
		await screen.findByRole('heading', { level: 1, name: '2 vehicles' });
		expect(screen.queryByTestId('no-per-distance-note')).toBeNull();
	});

	test("labels each odometer in the car's own unit and falls back to its other readings", async () => {
		const metric = {
			...TESLA,
			unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
		} as Vehicle;
		getVehicles.mockResolvedValue([CAMRY, metric]);
		getVehicleStats.mockImplementation(id =>
			Promise.resolve(
				(id === 'v1'
					? { currentOdometer: null, currentMileage: 40100 }
					: { currentOdometer: 64950, currentMileage: null }) as VehicleStats
			)
		);
		render(Page);

		expect(await screen.findByText('2020 Toyota Camry · ABC123 · 40,100 mi')).toBeInTheDocument();
		expect(await screen.findByText('electric · 64,950 km')).toBeInTheDocument();
	});

	test('puts vehicles shared with me under Shared with you, and says so when there are none', async () => {
		render(Page);
		expect(
			await screen.findByText('No one has shared a vehicle with you yet.')
		).toBeInTheDocument();

		getVehicles.mockResolvedValue([CAMRY, LENT]);
		render(Page);
		const sharedList = await screen.findByRole('list', { name: 'Vehicles shared with you' });
		expect(within(sharedList).getByRole('link', { name: '2019 Honda Civic' })).toBeInTheDocument();
		expect(within(sharedList).getByText('Shared by Sam')).toBeInTheDocument();
	});

	test('a share I already accepted is listed as a car, with no Accept or Decline and one "Shared with you" heading', async () => {
		getVehicles.mockResolvedValue([CAMRY, LENT]);
		listReceived.mockResolvedValue([
			{
				id: 's1',
				vehicleId: 'v3',
				ownerId: 'sam',
				sharedWithId: 'me',
				level: 'viewer',
				status: 'accepted',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				vehicleName: '2019 Honda Civic',
				sharedBy: 'Sam'
			} as ReceivedShare
		]);
		render(Page);

		const sharedList = await screen.findByRole('list', { name: 'Vehicles shared with you' });
		expect(within(sharedList).getByRole('link', { name: '2019 Honda Civic' })).toBeInTheDocument();
		await waitFor(() => expect(listReceived).toHaveBeenCalled());
		expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull();
		expect(screen.getAllByText('Shared with you')).toHaveLength(1);
	});

	test('a pending invitation is offered under the page heading, without a second title', async () => {
		listReceived.mockResolvedValue([
			{
				id: 's2',
				vehicleId: 'v9',
				ownerId: 'sam',
				sharedWithId: 'me',
				level: 'editor',
				status: 'pending',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				vehicleName: 'Family SUV',
				sharedBy: 'Sam'
			} as ReceivedShare
		]);
		render(Page);

		const invites = await screen.findByRole('list', { name: 'Invitations to accept' });
		expect(within(invites).getByText('Family SUV')).toBeInTheDocument();
		expect(
			within(invites).getByRole('button', { name: /Accept access to Family SUV/ })
		).toBeTruthy();
		expect(screen.getAllByText('Shared with you')).toHaveLength(1);
		expect(screen.queryByText('No one has shared a vehicle with you yet.')).toBeNull();
	});

	test('with no vehicles of my own, shows the first-run empty state and no Add vehicle header button', async () => {
		getVehicles.mockResolvedValue([]);
		render(Page);

		expect(
			await screen.findByRole('heading', { level: 1, name: '0 vehicles' })
		).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Add a vehicle first' })).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Your vehicles' })).toBeNull();
	});

	test('a failed load offers Retry, which loads again', async () => {
		getVehicles.mockRejectedValueOnce(new ApiError('boom', 500));
		render(Page);

		const retry = await screen.findByRole('button', { name: /Retry/ });
		expect(screen.getByRole('heading', { level: 1, name: 'Garage' })).toBeInTheDocument();
		retry.click();
		expect(
			await screen.findByRole('heading', { level: 1, name: '2 vehicles' })
		).toBeInTheDocument();
	});
});
