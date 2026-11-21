import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle, VehicleFinancing } from '#lib/types/index.ts';
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

async function saveEditedVehicle(edit?: () => Promise<void>) {
	render(VehicleForm, { props: { vehicleId: 'v1' } });
	await screen.findByDisplayValue('Bank of America');
	await edit?.();
	await fireEvent.click(screen.getByRole('button', { name: /update vehicle/i }));
	await waitFor(() => expect(createFinancing).toHaveBeenCalledTimes(1));
	return createFinancing.mock.calls[0]?.[1] as Partial<VehicleFinancing>;
}

describe('VehicleForm loan payment on edit', () => {
	beforeEach(() => {
		createFinancing.mockClear();
	});

	test('keeps the saved payment when the loan terms are unchanged', async () => {
		const saved = await saveEditedVehicle(async () => {
			await fireEvent.input(screen.getByLabelText('Nickname'), {
				target: { value: 'Commuter' }
			});
		});
		expect(saved.paymentAmount).toBe(400);
	});

	test('hides the recalculated preview while the loan terms are unchanged', async () => {
		render(VehicleForm, { props: { vehicleId: 'v1' } });
		await screen.findByDisplayValue('Bank of America');
		expect(screen.queryByText('Updated Loan Calculation Preview')).toBeNull();
	});

	test('recomputes the payment when the loan terms change', async () => {
		const saved = await saveEditedVehicle(async () => {
			await fireEvent.input(screen.getByLabelText(/Original Loan Amount/), {
				target: { value: '30000' }
			});
			await screen.findByText('Updated Loan Calculation Preview');
		});
		expect(saved.paymentAmount).toBe(559.29);
	});
});
