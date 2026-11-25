import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { PaginatedResponse, Trip } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const list =
	vi.fn<(filters: { vehicleId?: string; limit?: number }) => Promise<PaginatedResponse<Trip>>>();
vi.mock('#lib/services/trip-api.ts', () => ({
	tripApi: { list: (filters: { vehicleId?: string; limit?: number }) => list(filters) }
}));

import VehicleTripsTab from '../VehicleTripsTab.svelte';

function trip(overrides: Partial<Trip> & { id: string }): Trip {
	return {
		vehicleId: 'v1',
		startOdometer: 40000,
		endOdometer: 40120,
		purpose: 'business',
		tripDate: '2026-11-12',
		startLocation: 'Home',
		endLocation: 'Client site',
		createdAt: '2026-11-12T00:00:00.000Z',
		updatedAt: '2026-11-12T00:00:00.000Z',
		...overrides
	};
}

function page(data: Trip[]): PaginatedResponse<Trip> {
	return {
		data,
		pagination: { totalCount: data.length, limit: 100, offset: 0 }
	} as PaginatedResponse<Trip>;
}

beforeEach(() => vi.clearAllMocks());

describe('VehicleTripsTab', () => {
	test("lists only this car's trips with route, date, purpose and distance in its unit", async () => {
		list.mockResolvedValue(
			page([
				trip({ id: 't1' }),
				trip({
					id: 't2',
					purpose: 'personal',
					startLocation: null,
					endLocation: 'Lake',
					startOdometer: 50,
					endOdometer: 80
				})
			])
		);
		render(VehicleTripsTab, { props: { vehicleId: 'v1', distanceUnit: 'kilometers' } });

		const section = await screen.findByTestId('vehicle-trips');
		expect(list).toHaveBeenCalledWith({ vehicleId: 'v1', limit: 100 });
		expect(within(section).getByRole('heading', { name: '2 trips' })).toBeInTheDocument();
		const [first, second] = within(section).getAllByRole('listitem');
		expect(first?.textContent).toContain('Home → Client site');
		expect(first?.textContent).toContain('Business');
		expect(first?.textContent).toMatch(/120\s*km/);
		expect(second?.textContent).toContain('Lake');
		expect(second?.textContent).toContain('Personal');
		expect(within(section).getByRole('link', { name: 'All trips' })).toHaveAttribute(
			'href',
			'/trips'
		);
	});

	test('with no trips, points to the Trips page', async () => {
		list.mockResolvedValue(page([]));
		render(VehicleTripsTab, { props: { vehicleId: 'v1', distanceUnit: 'miles' } });

		expect(await screen.findByText('No trips for this car yet')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Go to Trips' })).toHaveAttribute('href', '/trips');
	});

	test('a failed load offers Retry', async () => {
		list.mockRejectedValueOnce(new ApiError('down', 500));
		list.mockResolvedValueOnce(page([trip({ id: 't1' })]));
		render(VehicleTripsTab, { props: { vehicleId: 'v1', distanceUnit: 'miles' } });

		await fireEvent.click(await screen.findByRole('button', { name: /Retry/ }));
		expect(await screen.findByTestId('vehicle-trips')).toBeInTheDocument();
	});
});
