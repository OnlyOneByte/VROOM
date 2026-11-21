import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import TargetVehiclePicker from '../TargetVehiclePicker.svelte';

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

function renderPicker(vehicles: Vehicle[], selectedId = '') {
	const onSelect = vi.fn();
	render(TargetVehiclePicker, {
		vehicles,
		selectedId,
		triggerId: 'target-vehicle',
		emptyText: 'Add a vehicle first.',
		onSelect
	});
	return { onSelect };
}

describe('TargetVehiclePicker', () => {
	test('shows the empty text instead of a picker when there are no vehicles', () => {
		renderPicker([]);

		expect(screen.getByText('Add a vehicle first.')).toBeInTheDocument();
		expect(screen.queryByRole('combobox')).toBeNull();
	});

	test('prompts for a choice when nothing is selected', () => {
		renderPicker([CAMRY, RAV4]);

		expect(screen.getByLabelText('Import into vehicle *')).toHaveTextContent('Select a vehicle');
	});

	test('names the selected vehicle, preferring its nickname', () => {
		renderPicker([CAMRY, RAV4], 'v2');

		expect(screen.getByLabelText('Import into vehicle *')).toHaveTextContent('Hauler');
	});

	test('treats an unknown selected id as no selection', () => {
		renderPicker([CAMRY], 'gone');

		expect(screen.getByLabelText('Import into vehicle *')).toHaveTextContent('Select a vehicle');
	});

	test('choosing a vehicle reports its id', async () => {
		const { onSelect } = renderPicker([CAMRY, RAV4]);
		const trigger = screen.getByRole('combobox');

		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: 'Hauler' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);

		expect(onSelect).toHaveBeenCalledWith('v2');
	});
});
