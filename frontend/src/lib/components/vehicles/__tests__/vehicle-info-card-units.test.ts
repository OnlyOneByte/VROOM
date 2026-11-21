import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
	}
}));

const VehicleInfoCard = (await import('../VehicleInfoCard.svelte')).default;

const VEHICLE: Vehicle = {
	id: 'veh-1',
	make: 'Toyota',
	model: 'Corolla',
	year: 2021,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	initialMileage: 45000,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};

describe('VehicleInfoCard initial mileage unit', () => {
	test("labels the initial mileage with the vehicle's own distance unit", () => {
		render(VehicleInfoCard, {
			props: {
				vehicle: {
					...VEHICLE,
					unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
				}
			}
		});

		expect(screen.getByText(/45,000\s+km/)).toBeTruthy();
		expect(screen.queryByText(/45,000\s+mi/)).toBeNull();
	});

	test("falls back to the user's unit when the vehicle has none", () => {
		render(VehicleInfoCard, { props: { vehicle: VEHICLE } });

		expect(screen.getByText(/45,000\s+mi/)).toBeTruthy();
	});
});
