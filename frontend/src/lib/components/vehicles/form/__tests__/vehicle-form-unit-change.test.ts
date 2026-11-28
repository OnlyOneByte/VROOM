import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { UpdateVehicleRequest, Vehicle, VehicleFinancing } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

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
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle,
		getFinancing,
		createVehicle: vi.fn(),
		updateVehicle,
		deleteVehicle: vi.fn(),
		payOffFinancing
	}
}));

const VehicleForm = (await import('../VehicleForm.svelte')).default;

const EXISTING: Vehicle = {
	id: 'veh-1',
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	initialMileage: 45000,
	unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
	createdAt: '2024-03-15T12:00:00.000Z',
	updatedAt: '2024-03-15T12:00:00.000Z'
};

const unitChangeRejection = () =>
	new ApiError('Changing units does not convert readings already saved for this vehicle.', 400, {
		requiresUnitChangeConfirmation: true,
		changedUnits: ['distanceUnit']
	});

async function choose(id: string, name: string): Promise<void> {
	const trigger = document.getElementById(id);
	if (!trigger) throw new Error(`no select #${id}`);
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

async function renderEditAndSwitchToKilometers(): Promise<void> {
	getVehicle.mockResolvedValue(EXISTING);
	render(VehicleForm, { props: { vehicleId: EXISTING.id } });
	await screen.findByRole('button', { name: /save changes/i });
	await fireEvent.click(screen.getByRole('button', { name: 'Change units' }));
	await choose('distanceUnit', 'Kilometers');
	await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
}

beforeEach(() => {
	vi.clearAllMocks();
	getFinancing.mockResolvedValue(null);
	appStore.clearNotifications();
	appStore.setVehicles([EXISTING]);
});

const LOAN = {
	id: 'fin-1',
	vehicleId: EXISTING.id,
	financingType: 'loan',
	provider: 'Credit Union',
	originalAmount: 20000,
	apr: 4.5,
	termMonths: 60,
	startDate: '2024-01-15T12:00:00.000Z',
	paymentAmount: 373,
	paymentFrequency: 'monthly',
	isActive: true,
	createdAt: '2024-01-15T12:00:00.000Z',
	updatedAt: '2024-01-15T12:00:00.000Z'
} satisfies VehicleFinancing;

async function renderFinancedEditOwnAndKilometers(): Promise<void> {
	getVehicle.mockResolvedValue(EXISTING);
	getFinancing.mockResolvedValue(LOAN);
	payOffFinancing.mockResolvedValue({ ...LOAN, isActive: false });
	render(VehicleForm, { props: { vehicleId: EXISTING.id } });
	await screen.findByRole('button', { name: /save changes/i });
	await fireEvent.click(screen.getByRole('button', { name: 'Change units' }));
	await choose('distanceUnit', 'Kilometers');
	await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
	await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
	const payoff = await screen.findByRole('alertdialog');
	await fireEvent.click(within(payoff).getByRole('button', { name: 'Mark paid off' }));
	await waitFor(() =>
		expect(screen.getByRole('alertdialog').textContent).toContain('Change units for this vehicle?')
	);
}

describe('VehicleForm unit change together with paying off the loan', () => {
	test('switching to Own and changing units asks for both, pays off once and saves with the flag', async () => {
		updateVehicle.mockRejectedValueOnce(unitChangeRejection()).mockResolvedValueOnce(EXISTING);
		await renderFinancedEditOwnAndKilometers();
		await fireEvent.click(screen.getByRole('button', { name: 'Change units' }));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/veh-1'));
		expect(payOffFinancing).toHaveBeenCalledTimes(1);
		expect(updateVehicle).toHaveBeenCalledTimes(2);
		expect(updateVehicle.mock.calls[1]?.[1].confirmUnitChange).toBe(true);
	});

	test('cancelling the unit dialog after the payoff never pays off a second time', async () => {
		updateVehicle.mockRejectedValue(unitChangeRejection());
		await renderFinancedEditOwnAndKilometers();

		await fireEvent.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
		);
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Change units for this vehicle?');
		expect(payOffFinancing).toHaveBeenCalledTimes(1);
		expect(updateVehicle).toHaveBeenCalledTimes(2);
	});
});

describe('VehicleForm unit change on a vehicle with saved readings', () => {
	test('asks before changing units and explains that saved readings are not converted', async () => {
		updateVehicle.mockRejectedValueOnce(unitChangeRejection());

		await renderEditAndSwitchToKilometers();

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Change units for this vehicle?');
		expect(dialog.textContent).toContain('distance from Miles to Kilometers');
		expect(dialog.textContent).toContain('are not converted');
		expect(dialog.textContent).toContain('a saved 100 miles would read 100 kilometers');
		expect(updateVehicle).toHaveBeenCalledTimes(1);
		expect(updateVehicle.mock.calls[0]?.[1].confirmUnitChange).toBeUndefined();
		expect(appStore.notifications.filter(n => n.type === 'error')).toHaveLength(0);
		expect(goto).not.toHaveBeenCalled();
	});

	test('confirming resends the update with confirmUnitChange and returns to the vehicle page', async () => {
		updateVehicle.mockRejectedValueOnce(unitChangeRejection()).mockResolvedValueOnce({
			...EXISTING,
			unitPreferences: { ...EXISTING.unitPreferences!, distanceUnit: 'kilometers' }
		});

		await renderEditAndSwitchToKilometers();
		await fireEvent.click(await screen.findByRole('button', { name: 'Change units' }));

		await waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(2));
		const resent = updateVehicle.mock.calls[1]?.[1];
		expect(resent?.confirmUnitChange).toBe(true);
		expect(resent?.unitPreferences?.distanceUnit).toBe('kilometers');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/veh-1'));
	});

	test('cancelling keeps the user on the form without saving', async () => {
		updateVehicle.mockRejectedValueOnce(unitChangeRejection());

		await renderEditAndSwitchToKilometers();
		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
		expect(updateVehicle).toHaveBeenCalledTimes(1);
		expect(goto).not.toHaveBeenCalled();
	});

	test('any other 400 still reports an update error', async () => {
		updateVehicle.mockRejectedValueOnce(new ApiError('Invalid VIN', 400));

		await renderEditAndSwitchToKilometers();

		await waitFor(() =>
			expect(appStore.notifications.map(n => n.message)).toContain(
				"Couldn't update the vehicle. Invalid VIN."
			)
		);
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});
});
