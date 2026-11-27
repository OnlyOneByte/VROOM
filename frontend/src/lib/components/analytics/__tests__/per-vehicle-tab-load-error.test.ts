import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));

const getVehicles = vi.fn<() => Promise<Vehicle[]>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));

const getVehicleHealth = vi.fn(() => new Promise(() => {}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		getVehicleHealth: () => getVehicleHealth(),
		getVehicleTCO: () => new Promise(() => {}),
		getVehicleExpenses: () => new Promise(() => {}),
		query: () => new Promise(() => {})
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

		expect(
			await screen.findByRole('button', { name: '2020 Toyota Camry', pressed: true })
		).toBeInTheDocument();
		expect(getVehicles).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load your vehicles")).toBeNull();
	});
});

describe('PerVehicleTab retrying the vehicles', () => {
	test('keeps the card and focus on Retry while it runs and after a repeat failure', async () => {
		let reject: (e: unknown) => void = () => {};
		getVehicles.mockRejectedValueOnce(new ApiError('boom', 500));
		getVehicles.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
		render(PerVehicleTab);
		const retry = await screen.findByRole('button', { name: 'Retry' });
		retry.focus();

		await fireEvent.click(retry);

		const running = screen.getByRole('button', { name: /Retrying/ });
		expect(document.activeElement).toBe(running);
		reject(new ApiError('boom', 500));

		const again = await screen.findByRole('button', { name: 'Retry' });
		expect(screen.getByText("Couldn't load your vehicles")).toBeInTheDocument();
		expect(document.activeElement).toBe(again);
	});
});

describe('PerVehicleTab when the vehicle analytics fail to load', () => {
	test('offers a 40px Retry', async () => {
		getVehicles.mockResolvedValueOnce([VEHICLE]);
		getVehicleHealth.mockRejectedValueOnce(new ApiError('boom', 500));
		render(PerVehicleTab);

		expect(await screen.findByText("Couldn't load vehicle analytics")).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('h-10');
	});
});
