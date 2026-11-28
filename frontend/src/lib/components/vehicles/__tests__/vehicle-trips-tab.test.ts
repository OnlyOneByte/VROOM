import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { PaginatedResponse, Trip } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

type Filters = { vehicleId?: string; limit?: number; offset?: number };
const list = vi.fn<(filters: Filters) => Promise<PaginatedResponse<Trip>>>();
vi.mock('#lib/services/trip-api.ts', () => ({
	tripApi: { list: (filters: Filters) => list(filters) }
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

function page(data: Trip[], totalCount = data.length): PaginatedResponse<Trip> {
	return {
		data,
		pagination: { totalCount, limit: 100, offset: 0 }
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

	test('shows commute and other trips by their own purpose', async () => {
		list.mockResolvedValue(
			page([trip({ id: 't1', purpose: 'commute' }), trip({ id: 't2', purpose: 'other' })])
		);
		render(VehicleTripsTab, { props: { vehicleId: 'v1', distanceUnit: 'miles' } });

		const [first, second] = within(await screen.findByTestId('vehicle-trips')).getAllByRole(
			'listitem'
		);
		expect(first?.textContent).toContain('Commute');
		expect(second?.textContent).toContain('Other');
		expect(first?.textContent).not.toContain('Personal');
	});

	test('says when the list shows only the latest trips', async () => {
		list.mockResolvedValue({
			...page([trip({ id: 't1' })]),
			pagination: { totalCount: 140, limit: 100, offset: 0 }
		} as PaginatedResponse<Trip>);
		render(VehicleTripsTab, { props: { vehicleId: 'v1', distanceUnit: 'miles' } });

		const heading = await screen.findByRole('heading', { level: 2 });
		expect(heading.textContent?.replace(/\s+/g, ' ').trim()).toBe('140 trips · latest 1');
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

	test('Load more fetches the next trips for this car and adds them', async () => {
		list.mockImplementation(filters =>
			Promise.resolve(
				filters.offset
					? page([trip({ id: 't2', endLocation: 'Older place' })], 2)
					: page([trip({ id: 't1' })], 2)
			)
		);
		render(VehicleTripsTab, { props: { vehicleId: 'v1', distanceUnit: 'kilometers' } });
		const section = await screen.findByTestId('vehicle-trips');

		await fireEvent.click(within(section).getByRole('button', { name: 'Load more trips' }));

		expect(await within(section).findByText(/Older place/)).toBeInTheDocument();
		expect(list).toHaveBeenLastCalledWith({ vehicleId: 'v1', limit: 100, offset: 1 });
		expect(within(section).getAllByRole('listitem')).toHaveLength(2);
		expect(within(section).queryByRole('button', { name: 'Load more trips' })).toBeNull();
	});
});
