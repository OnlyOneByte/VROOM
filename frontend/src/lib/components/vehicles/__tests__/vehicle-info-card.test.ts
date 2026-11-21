import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/paths', () => ({
	resolve: (path: string, params?: Record<string, string>) =>
		params ? path.replace(/\[(\w+)\]/g, (_m, key: string) => params[key] ?? '') : path
}));

const VehicleInfoCard = (await import('../VehicleInfoCard.svelte')).default;

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
	return {
		id: 'veh-7',
		make: 'Subaru',
		model: 'Outback',
		year: 2018,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

function valueFor(label: string): string | null | undefined {
	return screen.getByText(label).nextElementSibling?.textContent?.replace(/\s+/g, ' ').trim();
}

afterEach(() => {
	cleanup();
});

describe('VehicleInfoCard', () => {
	test('always shows make, model and year', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle() } });
		expect(valueFor('Make & Model')).toBe('Subaru Outback');
		expect(valueFor('Year')).toBe('2018');
	});

	test('omits optional fields the vehicle does not have', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle() } });
		for (const label of [
			'License Plate',
			'VIN',
			'Initial Mileage',
			'Purchase Date',
			'Purchase Price'
		]) {
			expect(screen.queryByText(label)).toBeNull();
		}
	});

	test('shows every optional field with formatted values', () => {
		render(VehicleInfoCard, {
			props: {
				vehicle: vehicle({
					licensePlate: 'ABC-123',
					vin: '1HGCM82633A004352',
					initialMileage: 45210,
					purchaseDate: '2021-06-15T12:00:00.000Z',
					purchasePrice: 27999.5
				})
			}
		});

		expect(valueFor('License Plate')).toBe('ABC-123');
		expect(valueFor('VIN')).toBe('1HGCM82633A004352');
		expect(valueFor('Initial Mileage')).toBe('45,210 mi');
		expect(valueFor('Purchase Date')).toBe('Jun 15, 2021');
		expect(valueFor('Purchase Price')).toBe('$27,999.50');
	});

	test('a zero initial mileage or price is treated as not set', () => {
		render(VehicleInfoCard, {
			props: { vehicle: vehicle({ initialMileage: 0, purchasePrice: 0 }) }
		});
		expect(screen.queryByText('Initial Mileage')).toBeNull();
		expect(screen.queryByText('Purchase Price')).toBeNull();
	});

	test('owners get an edit link to the vehicle edit page', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle() } });
		expect(screen.getByRole('link', { name: 'Edit vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/veh-7/edit'
		);
	});

	test('non-owners get no edit link', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle(), isOwner: false } });
		expect(screen.queryByRole('link', { name: 'Edit vehicle' })).toBeNull();
		expect(screen.getByText('Vehicle Information')).toBeInTheDocument();
	});
});
