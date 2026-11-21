import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import SplitMileageReadings from '../SplitMileageReadings.svelte';

const CAMRY: Vehicle = {
	id: 'v1',
	year: 2020,
	make: 'Toyota',
	model: 'Camry',
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4', nickname: 'Hauler' };
const CIVIC: Vehicle = { ...CAMRY, id: 'v3', make: 'Honda', model: 'Civic' };

function renderReadings(
	overrides: Partial<{
		selectedVehicleIds: string[];
		mileages: Record<string, string>;
		open: boolean;
	}> = {}
) {
	const onMileageInput = vi.fn();
	render(SplitMileageReadings, {
		vehicles: [CAMRY, RAV4, CIVIC],
		selectedVehicleIds: ['v1', 'v2'],
		mileages: {},
		onMileageInput,
		...overrides
	});
	return { onMileageInput };
}

function toggle(): HTMLElement {
	return screen.getByRole('button', { name: /Add mileage readings/ });
}

describe('SplitMileageReadings', () => {
	test('starts collapsed with no mileage inputs', () => {
		renderReadings();

		expect(toggle()).toHaveTextContent('▸');
		expect(screen.queryByPlaceholderText('Current mileage')).toBeNull();
	});

	test('expanding shows one input per selected vehicle, labelled by vehicle', async () => {
		renderReadings();

		await fireEvent.click(toggle());

		expect(toggle()).toHaveTextContent('▾');
		expect(screen.getAllByPlaceholderText('Current mileage')).toHaveLength(2);
		expect(screen.getByLabelText('2020 Toyota Camry')).toBeInTheDocument();
		expect(screen.getByLabelText('Hauler')).toBeInTheDocument();
		expect(screen.queryByLabelText('2020 Honda Civic')).toBeNull();
	});

	test('collapsing again hides the inputs', async () => {
		renderReadings({ open: true });

		await fireEvent.click(toggle());

		expect(screen.queryByPlaceholderText('Current mileage')).toBeNull();
	});

	test('prefills each input from the recorded mileages', () => {
		renderReadings({ open: true, mileages: { v1: '45200' } });

		expect(screen.getByLabelText('2020 Toyota Camry')).toHaveValue(45200);
		expect(screen.getByLabelText('Hauler')).toHaveValue(null);
	});

	test('typing a reading reports it against the right vehicle', async () => {
		const { onMileageInput } = renderReadings({ open: true });

		await fireEvent.input(screen.getByLabelText('Hauler'), { target: { value: '1200' } });

		expect(onMileageInput).toHaveBeenCalledWith('v2', '1200');
	});

	test('skips selected ids that no longer match a vehicle', () => {
		renderReadings({ open: true, selectedVehicleIds: ['v1', 'gone'] });

		expect(screen.getAllByPlaceholderText('Current mileage')).toHaveLength(1);
	});
});
