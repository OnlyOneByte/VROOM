import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';
import ImportSourceDetection from '../ImportSourceDetection.svelte';

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
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4' };

const FUELIO: DetectedImportFormat = {
	id: 'fuelio',
	label: 'Fuelio'
};

function renderDetection(
	overrides: Partial<{
		isDetecting: boolean;
		preset: DetectedImportFormat | null;
		vehicles: Vehicle[];
		targetVehicleId: string;
	}> = {}
) {
	const onVehicleChange = vi.fn();
	render(ImportSourceDetection, {
		isDetecting: false,
		preset: null,
		vehicles: [CAMRY, RAV4],
		targetVehicleId: '',
		onVehicleChange,
		...overrides
	});
	return { onVehicleChange };
}

describe('ImportSourceDetection', () => {
	test('shows a detecting indicator while the source is being identified', () => {
		renderDetection({ isDetecting: true, preset: FUELIO });

		expect(screen.getByText('Detecting format…')).toBeInTheDocument();
		expect(screen.queryByText('Fuelio')).toBeNull();
	});

	test('renders nothing when no preset was detected', () => {
		const { container } = render(ImportSourceDetection, {
			isDetecting: false,
			preset: null,
			vehicles: [CAMRY],
			targetVehicleId: '',
			onVehicleChange: vi.fn()
		});

		expect(container.textContent?.trim()).toBe('');
	});

	test('names the detected fuel log and asks which vehicle it belongs to', () => {
		renderDetection({ preset: FUELIO, targetVehicleId: 'v1' });

		expect(screen.getByText('Fuelio')).toBeInTheDocument();
		expect(screen.getByLabelText('Import into vehicle *')).toHaveTextContent('2020 Toyota Camry');
	});

	test('choosing a vehicle reports its id', async () => {
		const { onVehicleChange } = renderDetection({ preset: FUELIO });
		const trigger = screen.getByLabelText('Import into vehicle *');
		expect(trigger).toHaveTextContent('Select a vehicle');

		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: '2020 Toyota RAV4' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);

		expect(onVehicleChange).toHaveBeenCalledWith('v2');
	});

	test('tells the user to add a vehicle when they have none', () => {
		renderDetection({ preset: FUELIO, vehicles: [] });

		expect(screen.getByText('Add a vehicle first to import a fuel log.')).toBeInTheDocument();
	});
});
