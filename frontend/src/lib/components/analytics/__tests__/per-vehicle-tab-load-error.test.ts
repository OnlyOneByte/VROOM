import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));

const getVehicles = vi.fn<() => Promise<Vehicle[]>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		getVehicleHealth: () => new Promise(() => {}),
		getVehicleTCO: () => new Promise(() => {}),
		getVehicleExpenses: () => new Promise(() => {})
	},
	getDefaultDateRange: () => ({})
}));

import PerVehicleTab from '../PerVehicleTab.svelte';

const VEHICLE = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020
} as unknown as Vehicle;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('PerVehicleTab when the vehicles fail to load', () => {
	test('shows the failure with a Retry instead of saying there are no vehicles', async () => {
		getVehicles.mockRejectedValueOnce(new ApiError('boom', 500));
		getVehicles.mockResolvedValueOnce([VEHICLE]);
		render(PerVehicleTab);

		expect(await screen.findByText("Couldn't load your vehicles")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText(/No vehicles found/)).toBeNull();
		expect(screen.queryByText('boom')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(await screen.findByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument();
		expect(getVehicles).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load your vehicles")).toBeNull();
	});
});
