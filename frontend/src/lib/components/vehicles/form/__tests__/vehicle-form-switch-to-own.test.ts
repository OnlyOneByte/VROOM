import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { UpdateVehicleRequest, Vehicle, VehicleFinancing } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

const goto = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({
	goto,
	refreshAll: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

const getVehicle = vi.fn<(id: string) => Promise<Vehicle>>();
const getFinancing = vi.fn<(id: string) => Promise<VehicleFinancing | null>>();
const updateVehicle = vi.fn<(id: string, data: UpdateVehicleRequest) => Promise<Vehicle>>();
const payOffFinancing = vi.fn<(id: string) => Promise<VehicleFinancing>>();
const createFinancing = vi.fn();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle,
		getFinancing,
		createVehicle: vi.fn(),
		updateVehicle,
		deleteVehicle: vi.fn(),
		createFinancing,
		payOffFinancing
	}
}));

const VehicleForm = (await import('../VehicleForm.svelte')).default;

const VEHICLE: Vehicle = {
	id: 'veh-1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
	createdAt: '2024-03-15T12:00:00.000Z',
	updatedAt: '2024-03-15T12:00:00.000Z'
};

function financing(financingType: 'loan' | 'lease'): VehicleFinancing {
	return {
		id: 'fin-1',
		vehicleId: VEHICLE.id,
		financingType,
		provider: 'Credit Union',
		originalAmount: 20000,
		apr: 4.5,
		termMonths: 60,
		startDate: '2024-01-15T12:00:00.000Z',
		paymentAmount: 373,
		paymentFrequency: 'monthly',
		paymentDayOfMonth: 15,
		isActive: true
	} as VehicleFinancing;
}

async function renderEditAndSwitchToOwn(financingType: 'loan' | 'lease' = 'loan'): Promise<void> {
	getVehicle.mockResolvedValue(VEHICLE);
	getFinancing.mockResolvedValue(financing(financingType));
	render(VehicleForm, { props: { vehicleId: VEHICLE.id } });
	await screen.findByRole('button', { name: /save changes/i });
	await fireEvent.click(screen.getByRole('button', { name: 'Own' }));
	await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
}

beforeEach(() => {
	vi.clearAllMocks();
	appStore.clearNotifications();
	appStore.setVehicles([VEHICLE]);
	updateVehicle.mockResolvedValue(VEHICLE);
	payOffFinancing.mockResolvedValue({ ...financing('loan'), isActive: false });
});

describe('VehicleForm switching a financed vehicle to Own', () => {
	test('asks before saving and names the loan being paid off', async () => {
		await renderEditAndSwitchToOwn();

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Mark the loan as paid off?');
		expect(dialog.textContent).toContain('Credit Union');
		expect(updateVehicle).not.toHaveBeenCalled();
		expect(payOffFinancing).not.toHaveBeenCalled();
	});

	test('confirming pays off the loan, then saves the vehicle and returns to it', async () => {
		await renderEditAndSwitchToOwn();
		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Mark Paid Off' }));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/veh-1'));
		expect(payOffFinancing).toHaveBeenCalledWith('fin-1');
		expect(updateVehicle).toHaveBeenCalledTimes(1);
		expect(payOffFinancing.mock.invocationCallOrder[0]).toBeLessThan(
			updateVehicle.mock.invocationCallOrder[0]!
		);
		expect(createFinancing).not.toHaveBeenCalled();
	});

	test('a lease gets its own wording', async () => {
		await renderEditAndSwitchToOwn('lease');

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('End the lease?');
		expect(within(dialog).getByRole('button', { name: 'End Lease' })).toBeTruthy();
	});

	test('cancelling saves nothing and leaves the loan active', async () => {
		await renderEditAndSwitchToOwn();
		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
		expect(payOffFinancing).not.toHaveBeenCalled();
		expect(updateVehicle).not.toHaveBeenCalled();
	});

	test('a failed payoff reports it, saves nothing and keeps the dialog open to retry', async () => {
		payOffFinancing.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		await renderEditAndSwitchToOwn();
		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Mark Paid Off' }));

		await waitFor(() =>
			expect(appStore.notifications.map(n => n.message)).toContain(
				`Couldn't mark the loan as paid off. ${SERVER_FAILURE_MESSAGE}`
			)
		);
		expect(updateVehicle).not.toHaveBeenCalled();
		expect(screen.getByRole('alertdialog')).toBeTruthy();
	});

	test('a vehicle without active financing saves straight away as Own', async () => {
		getVehicle.mockResolvedValue(VEHICLE);
		getFinancing.mockResolvedValue(null);
		render(VehicleForm, { props: { vehicleId: VEHICLE.id } });
		await screen.findByRole('button', { name: /save changes/i });
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

		await waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});

	test('the dialog keeps its title and text while the vehicle save is still running', async () => {
		let finishSave: (v: Vehicle) => void = () => {};
		updateVehicle.mockReturnValueOnce(new Promise<Vehicle>(resolve => (finishSave = resolve)));
		await renderEditAndSwitchToOwn();
		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Mark Paid Off' }));

		await waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(1));
		expect(payOffFinancing).toHaveBeenCalledTimes(1);
		const working = screen.getByRole('alertdialog');
		expect(working.textContent).toContain('Mark the loan as paid off?');
		expect(working.textContent).toContain('Credit Union');

		finishSave(VEHICLE);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/veh-1'));
	});
});
