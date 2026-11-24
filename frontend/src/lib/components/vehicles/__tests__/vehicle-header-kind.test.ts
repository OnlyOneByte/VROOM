import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import VehicleHeader from '../VehicleHeader.svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { vehicleKindIcon, vehicleKindNote } from '#lib/utils/vehicle-kind.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const base = { id: 'v1', year: 2021, make: 'Ducati', model: 'Monster' } as Vehicle;

describe('vehicle kind in the header', () => {
	test('a car says nothing extra', () => {
		render(VehicleHeader, { vehicle: { ...base, vehicleKind: 'car' }, displayName: 'Red' });
		expect(screen.getByText('2021 Ducati Monster')).toBeInTheDocument();
		expect(screen.queryByText(/Car ·/)).toBeNull();
	});

	test('a vehicle saved before kinds existed is treated as a car', () => {
		render(VehicleHeader, { vehicle: base, displayName: 'Red' });
		expect(screen.getByText('2021 Ducati Monster')).toBeInTheDocument();
	});

	test('another kind leads the description line', () => {
		render(VehicleHeader, {
			vehicle: { ...base, vehicleKind: 'motorcycle' },
			displayName: 'Red'
		});
		const line = screen.getByText(/Motorcycle ·/);
		expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe('Motorcycle · 2021 Ducati Monster');
	});
});

describe('vehicleKindNote and vehicleKindIcon', () => {
	test('only non-car kinds get a note', () => {
		expect(vehicleKindNote(undefined)).toBeNull();
		expect(vehicleKindNote('car')).toBeNull();
		expect(vehicleKindNote('rv')).toBe('RV');
		expect(vehicleKindNote('other')).toBe('Other');
	});

	test('each kind has an icon, falling back to the car', () => {
		expect(vehicleKindIcon('truck')).not.toBe(vehicleKindIcon('car'));
		expect(vehicleKindIcon(undefined)).toBe(vehicleKindIcon('car'));
	});
});
