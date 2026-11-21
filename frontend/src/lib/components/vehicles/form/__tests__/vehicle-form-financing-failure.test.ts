import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle, VehicleFinancing } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import VehicleForm from '../VehicleForm.svelte';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	refreshAll: vi.fn(() => Promise.resolve())
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const FINANCING: VehicleFinancing = {
	id: 'f1',
	vehicleId: 'v1',
	financingType: 'loan',
	provider: 'Bank of America',
	originalAmount: 20_000,
	computedBalance: 10_000,
	apr: 4.5,
	termMonths: 60,
	startDate: '2020-03-15T12:00:00.000Z',
	paymentAmount: 400,
	paymentFrequency: 'monthly',
	paymentDayOfMonth: 15,
	isActive: true,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};

const VEHICLE = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const createFinancing = vi.fn((..._args: unknown[]) => Promise.resolve({}));

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle: () => Promise.resolve({ ...VEHICLE }),
		getFinancing: () => Promise.resolve({ ...FINANCING }),
		updateVehicle: () => Promise.resolve({ ...VEHICLE }),
		createVehicle: () => Promise.resolve({ ...VEHICLE }),
		createFinancing: (...args: unknown[]) => createFinancing(...args)
	}
}));

describe('VehicleForm when the vehicle saves but its financing does not', () => {
	test('warns in plain sentences, without the raw server text', async () => {
		createFinancing.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		render(VehicleForm, { props: { vehicleId: 'v1' } });
		await screen.findByDisplayValue('Bank of America');

		await fireEvent.click(screen.getByRole('button', { name: /update vehicle/i }));

		await waitFor(() =>
			expect(appStore.notifications.map(n => n.message)).toContain(
				`The vehicle was saved, but its financing couldn't be saved. ${SERVER_FAILURE_MESSAGE}`
			)
		);
		expect(appStore.notifications.map(n => n.message).join(' ')).not.toContain(
			'Internal server error'
		);
	});
});
