import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Trip, Vehicle } from '#lib/types/index.ts';

vi.mock('#lib/components/trips/TripForm.svelte', () => ({ default: () => {} }));

const listTrips = vi.fn();
vi.mock('#lib/services/trip-api.ts', () => ({
	tripApi: {
		list: (...args: unknown[]) => listTrips(...args),
		getSummary: () =>
			Promise.resolve({
				totalDistance: 10,
				tripCount: 1,
				businessDistance: 0,
				averageTripDistance: 10
			})
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 } as Vehicle])
	}
}));

import Page from '../+page.svelte';

const TRIP = {
	id: 't1',
	vehicleId: 'v1',
	purpose: 'personal',
	tripDate: '2024-01-01T00:00:00.000Z',
	startOdometer: 100,
	endOdometer: 110,
	startLocation: null,
	endLocation: null,
	note: null
} as unknown as Trip;

function logTripControls() {
	return screen.queryAllByRole('button', { name: 'Log Trip' });
}

function belowLg() {
	return logTripControls().filter(control => !control.classList.contains('hidden'));
}

function fromLg() {
	return logTripControls().filter(control => !control.classList.contains('lg:hidden'));
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('/trips primary action', () => {
	test('the empty state offers Log Trip once', async () => {
		listTrips.mockImplementation(() =>
			Promise.resolve({ data: [], pagination: { totalCount: 0, limit: 100, offset: 0 } })
		);
		render(Page);

		await waitFor(() => expect(screen.getByText('No trips yet')).toBeInTheDocument());
		expect(logTripControls()).toHaveLength(1);
	});

	test('a populated list offers Log Trip once', async () => {
		listTrips.mockImplementation(() =>
			Promise.resolve({ data: [TRIP], pagination: { totalCount: 1, limit: 100, offset: 0 } })
		);
		render(Page);

		await waitFor(() => expect(screen.getByTestId('trip-card-t1')).toBeInTheDocument());
		expect(belowLg()).toHaveLength(1);
		expect(belowLg()[0]).toHaveClass('fixed');
		expect(fromLg()).toHaveLength(1);
		expect(fromLg()[0]).not.toHaveClass('fixed');
	});
});
