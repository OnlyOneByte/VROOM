import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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
	test('shows the year and leaves make and model to the page header', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle() } });
		expect(valueFor('Year')).toBe('2018');
		expect(screen.queryByText('Make & Model')).toBeNull();
	});

	test('below sm the details sit behind a one-line disclosure that names the plate and mileage', async () => {
		render(VehicleInfoCard, {
			props: { vehicle: vehicle({ licensePlate: 'ABC-123', initialMileage: 18000 }) }
		});
		const toggle = screen.getByRole('button', { name: /Details:/ });
		expect(toggle).toHaveClass('sm:hidden');
		expect(toggle).toHaveTextContent('plate ABC-123, 18,000 mi initial');
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
		expect(panel).toHaveClass('hidden', 'sm:grid');

		await fireEvent.click(toggle);

		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(panel).not.toHaveClass('hidden');
		expect(panel).toHaveClass('grid');
	});

	test('the disclosure falls back to the year when there is no plate or mileage', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle() } });
		expect(screen.getByRole('button', { name: /Details:/ })).toHaveTextContent('Details: 2018');
	});

	test('omits optional fields the vehicle does not have', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle() } });
		for (const label of [
			'License plate',
			'VIN',
			'Initial mileage',
			'Purchase date',
			'Purchase price'
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
					purchaseDate: new Date(2021, 5, 15, 12).toISOString(),
					purchasePrice: 27999.5
				})
			}
		});

		expect(valueFor('License plate')).toBe('ABC-123');
		expect(valueFor('VIN')).toBe('1HGCM82633A004352');
		expect(valueFor('Initial mileage')).toBe('45,210 mi');
		expect(valueFor('Purchase date')).toBe('Jun 15, 2021');
		expect(valueFor('Purchase price')).toBe('$27,999.50');
	});

	test('a zero initial mileage or price is treated as not set', () => {
		render(VehicleInfoCard, {
			props: { vehicle: vehicle({ initialMileage: 0, purchasePrice: 0 }) }
		});
		expect(screen.queryByText('Initial mileage')).toBeNull();
		expect(screen.queryByText('Purchase price')).toBeNull();
	});

	test('owners get an edit link to the vehicle edit page', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle() } });
		expect(screen.getByRole('link', { name: 'Edit vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/veh-7/edit'
		);
		expect(screen.getByRole('link', { name: 'Edit vehicle' })).toHaveClass('size-10');
	});

	test('non-owners get no edit link', () => {
		render(VehicleInfoCard, { props: { vehicle: vehicle(), isOwner: false } });
		expect(screen.queryByRole('link', { name: 'Edit vehicle' })).toBeNull();
		expect(screen.getByText('Vehicle information')).toBeInTheDocument();
	});
});
