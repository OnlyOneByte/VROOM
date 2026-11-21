import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { UpdateVehicleRequest, Vehicle } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';

const goto = vi.fn(() => Promise.resolve());
const refreshAll = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({
	goto,
	refreshAll,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

const getVehicle = vi.fn<(id: string) => Promise<Vehicle>>();
const getFinancing = vi.fn(() => Promise.resolve(null));
const createVehicle = vi.fn<(data: Partial<Vehicle>) => Promise<Vehicle>>();
const updateVehicle = vi.fn<(id: string, data: UpdateVehicleRequest) => Promise<Vehicle>>();
const deleteVehicle = vi.fn<(id: string) => Promise<void>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicle, getFinancing, createVehicle, updateVehicle, deleteVehicle }
}));

const VehicleForm = (await import('../VehicleForm.svelte')).default;

const EXISTING: Vehicle = {
	id: 'veh-1',
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	vehicleType: 'hybrid',
	trackFuel: true,
	trackCharging: true,
	licensePlate: 'ABC-1234',
	nickname: 'Daily Driver',
	vin: '1HGBH41JXMN109186',
	initialMileage: 42000,
	purchasePrice: 18500,
	purchaseDate: '2024-03-15T12:00:00.000Z',
	unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
	createdAt: '2024-03-15T12:00:00.000Z',
	updatedAt: '2024-03-15T12:00:00.000Z'
};

function input(id: string): HTMLInputElement {
	const el = document.getElementById(id);
	if (!(el instanceof HTMLInputElement)) throw new Error(`no input #${id}`);
	return el;
}

async function type(id: string, value: string): Promise<void> {
	await fireEvent.input(input(id), { target: { value } });
}

async function openSelect(id: string): Promise<void> {
	const trigger = document.getElementById(id);
	if (!trigger) throw new Error(`no select #${id}`);
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
}

async function choose(id: string, name: string): Promise<void> {
	await openSelect(id);
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

function switchState(id: string): string | null {
	return document.getElementById(id)?.getAttribute('data-state') ?? null;
}

function errorText(field: string): string | null {
	return document.getElementById(`${field}-error`)?.textContent?.trim() ?? null;
}

function createdPayload(): Partial<Vehicle> {
	const [payload] = createVehicle.mock.calls.at(-1) ?? [];
	if (!payload) throw new Error('createVehicle was not called');
	return payload;
}

function updatedPayload(): UpdateVehicleRequest {
	const [, payload] = updateVehicle.mock.calls.at(-1) ?? [];
	if (!payload) throw new Error('updateVehicle was not called');
	return payload;
}

function notificationMessages(): string[] {
	return appStore.notifications.map(n => n.message);
}

async function renderCreate(): Promise<void> {
	render(VehicleForm, { props: {} });
	await screen.findByRole('heading', { name: 'Add New Vehicle' });
}

async function renderEdit(vehicle: Vehicle = EXISTING): Promise<void> {
	getVehicle.mockResolvedValue(vehicle);
	render(VehicleForm, { props: { vehicleId: vehicle.id } });
	await screen.findByRole('heading', { name: 'Edit Vehicle' });
}

async function fillRequired(): Promise<void> {
	await type('make', 'Toyota');
	await type('model', 'Camry');
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
	vi.clearAllMocks();
	getFinancing.mockResolvedValue(null);
	appStore.clearNotifications();
	appStore.setVehicles([]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('VehicleForm create mode', () => {
	test('starts empty with the current year, gas type, fuel tracking on and charging off', async () => {
		await renderCreate();

		expect(input('make').value).toBe('');
		expect(input('model').value).toBe('');
		expect(input('year').value).toBe('2026');
		expect(document.getElementById('vehicleType')?.textContent?.trim()).toBe('Gas');
		expect(switchState('trackFuel')).toBe('checked');
		expect(switchState('trackCharging')).toBe('unchecked');
		expect(screen.getByRole('button', { name: /add vehicle/i })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
	});

	test('summarises the default unit preferences while the units panel is collapsed', async () => {
		await renderCreate();

		expect(screen.getByText('Miles · Gallons (US) · kWh')).toBeTruthy();
	});

	test('blocks submit and flags make and model when both are blank', async () => {
		await renderCreate();

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		expect(errorText('make')).toBe('Make is required');
		expect(errorText('model')).toBe('Model is required');
		expect(input('make').getAttribute('aria-invalid')).toBe('true');
		expect(input('make').getAttribute('aria-describedby')).toBe('make-error');
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test('whitespace-only make is treated as missing', async () => {
		await renderCreate();
		await type('make', '   ');
		await type('model', 'Camry');

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		expect(errorText('make')).toBe('Make is required');
		expect(errorText('model')).toBeNull();
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test.each([
		['1899', 'before 1900'],
		['2029', 'more than two years ahead']
	])('rejects year %s (%s)', async year => {
		await renderCreate();
		await fillRequired();
		await type('year', year);

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		expect(errorText('year')).toBe('Please enter a valid year');
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test.each([
		['1HGBH41J-MN109', 'VIN must contain only letters and numbers'],
		['1HGBH41', 'VIN must be between 11 and 17 characters'],
		['1HGBH41JXMN1091867', 'VIN must be between 11 and 17 characters']
	])('rejects VIN %s with "%s"', async (vin, message) => {
		await renderCreate();
		await fillRequired();
		await type('vin', vin);

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		expect(errorText('vin')).toBe(message);
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test('a VIN error clears as soon as the VIN is corrected', async () => {
		await renderCreate();
		await fillRequired();
		await type('vin', 'BAD!');
		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
		expect(errorText('vin')).not.toBeNull();

		await type('vin', '1HGBH41JXMN109186');

		await vi.waitFor(() => expect(errorText('vin')).toBeNull());
	});

	test('rejects a negative initial mileage', async () => {
		await renderCreate();
		await fillRequired();
		await type('initialMileage', '-5');

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		expect(errorText('initialMileage')).toBe('Mileage cannot be negative');
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test('submits the entered details, upper-casing the VIN and omitting blank optionals', async () => {
		createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1', make: 'Toyota', model: 'Camry' });
		await renderCreate();
		await fillRequired();
		await type('year', '2021');
		await type('vin', '1hgbh41jxmn109186');
		await type('licensePlate', 'XYZ-987');
		await type('initialMileage', '1500');

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
		expect(createdPayload()).toEqual({
			make: 'Toyota',
			model: 'Camry',
			year: 2021,
			vehicleType: 'gas',
			trackFuel: true,
			trackCharging: false,
			unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
			licensePlate: 'XYZ-987',
			nickname: undefined,
			vin: '1HGBH41JXMN109186',
			initialMileage: 1500,
			purchasePrice: undefined,
			purchaseDate: undefined
		});
	});

	test('a successful create adds the vehicle, announces it and returns to the dashboard', async () => {
		const saved: Vehicle = { ...EXISTING, id: 'new-1', make: 'Toyota', model: 'Camry' };
		createVehicle.mockResolvedValue(saved);
		await renderCreate();
		await fillRequired();

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/dashboard'));
		expect(appStore.vehicles).toContainEqual(saved);
		expect(notificationMessages()).toContain('Vehicle added successfully!');
		expect(refreshAll).not.toHaveBeenCalled();
	});

	test('a failed create keeps the user on the form with an error notification', async () => {
		createVehicle.mockRejectedValue(new Error('boom'));
		await renderCreate();
		await fillRequired();

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain('Error adding vehicle. Please try again.')
		);
		expect(goto).not.toHaveBeenCalled();
		expect(appStore.vehicles).toEqual([]);
		expect(input('make').value).toBe('Toyota');
		expect(screen.getByRole('button', { name: /add vehicle/i }).hasAttribute('disabled')).toBe(
			false
		);
	});

	test('shows a busy, disabled submit button while the create is in flight', async () => {
		let release: (v: Vehicle) => void = () => {};
		createVehicle.mockReturnValue(new Promise<Vehicle>(r => (release = r)));
		await renderCreate();
		await fillRequired();

		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));

		const busy = await screen.findByRole('button', { name: /adding\.\.\./i });
		expect(busy.hasAttribute('disabled')).toBe(true);
		expect(screen.getByRole('button', { name: /cancel/i }).hasAttribute('disabled')).toBe(true);
		release({ ...EXISTING, id: 'new-1' });
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());
	});

	test.each([
		['Electric', 'electric', false, true],
		['Hybrid', 'hybrid', true, true],
		['Gas', 'gas', true, false]
	])(
		'choosing %s sets the energy tracking defaults',
		async (label, vehicleType, trackFuel, trackCharging) => {
			createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1' });
			await renderCreate();
			await fillRequired();
			if (vehicleType === 'gas') await choose('vehicleType', 'Electric');

			await choose('vehicleType', label);

			expect(document.getElementById('vehicleType')?.textContent?.trim()).toBe(label);
			expect(switchState('trackFuel')).toBe(trackFuel ? 'checked' : 'unchecked');
			expect(switchState('trackCharging')).toBe(trackCharging ? 'checked' : 'unchecked');
			await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
			await vi.waitFor(() => expect(createVehicle).toHaveBeenCalled());
			expect(createdPayload()).toMatchObject({ vehicleType, trackFuel, trackCharging });
		}
	);

	test('the energy tracking switches can be overridden after picking a type', async () => {
		createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		await renderCreate();
		await fillRequired();

		await fireEvent.click(document.getElementById('trackCharging') as HTMLElement);

		expect(switchState('trackCharging')).toBe('checked');
		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalled());
		expect(createdPayload()).toMatchObject({
			vehicleType: 'gas',
			trackFuel: true,
			trackCharging: true
		});
	});

	test('chosen distance and volume units are sent with the new vehicle', async () => {
		createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		await renderCreate();
		await fillRequired();
		await fireEvent.click(screen.getByRole('button', { name: /toggle unit preferences/i }));

		await choose('distanceUnit', 'Kilometers');
		await choose('volumeUnit', 'Liters');

		expect(document.getElementById('distanceUnit')?.textContent?.trim()).toBe('Kilometers');
		await fireEvent.click(screen.getByRole('button', { name: /add vehicle/i }));
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalled());
		expect(createdPayload().unitPreferences).toEqual({
			distanceUnit: 'kilometers',
			volumeUnit: 'liters',
			chargeUnit: 'kwh'
		});
	});

	test('cancel and the back arrow both return to the dashboard without saving', async () => {
		await renderCreate();

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

		expect(goto).toHaveBeenCalledTimes(2);
		expect(goto).toHaveBeenNthCalledWith(1, '/dashboard');
		expect(goto).toHaveBeenNthCalledWith(2, '/dashboard');
		expect(createVehicle).not.toHaveBeenCalled();
	});
});

describe('VehicleForm edit mode', () => {
	test('prefills every vehicle field and the subtitle from the loaded vehicle', async () => {
		await renderEdit();

		expect(getVehicle).toHaveBeenCalledWith('veh-1');
		expect(input('make').value).toBe('Honda');
		expect(input('model').value).toBe('Civic');
		expect(input('year').value).toBe('2019');
		expect(input('licensePlate').value).toBe('ABC-1234');
		expect(input('nickname').value).toBe('Daily Driver');
		expect(input('vin').value).toBe('1HGBH41JXMN109186');
		expect(input('initialMileage').value).toBe('42000');
		expect(input('purchasePrice').value).toBe('18500');
		expect(document.getElementById('vehicleType')?.textContent?.trim()).toBe('Hybrid');
		expect(switchState('trackFuel')).toBe('checked');
		expect(switchState('trackCharging')).toBe('checked');
		expect(screen.getByText('Daily Driver', { selector: 'p' })).toBeTruthy();
		expect(screen.getByText('Kilometers · Liters · kWh')).toBeTruthy();
	});

	test('falls back to year make model as the subtitle when the vehicle has no nickname', async () => {
		await renderEdit({ ...EXISTING, nickname: undefined });

		expect(screen.getByText('2019 Honda Civic', { selector: 'p' })).toBeTruthy();
		expect(input('nickname').value).toBe('');
	});

	test('a vehicle that fails to load is reported and the user is sent to the dashboard', async () => {
		getVehicle.mockRejectedValue(new Error('not found'));
		render(VehicleForm, { props: { vehicleId: 'gone' } });

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/dashboard'));
		expect(notificationMessages()).toContain('Error loading vehicle');
	});

	test('update sends edited fields and nulls for optionals the user emptied', async () => {
		updateVehicle.mockResolvedValue({ ...EXISTING, model: 'Accord' });
		await renderEdit();
		await type('model', 'Accord');
		await type('licensePlate', '');
		await type('nickname', '');

		await fireEvent.click(screen.getByRole('button', { name: /update vehicle/i }));

		await vi.waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(1));
		expect(updateVehicle.mock.calls[0]?.[0]).toBe('veh-1');
		expect(updatedPayload()).toEqual({
			make: 'Honda',
			model: 'Accord',
			year: 2019,
			vehicleType: 'hybrid',
			trackFuel: true,
			trackCharging: true,
			unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
			licensePlate: null,
			nickname: null,
			vin: '1HGBH41JXMN109186',
			initialMileage: 42000,
			purchasePrice: 18500,
			purchaseDate: dateOnlyToISO('2024-03-15')
		});
	});

	test('a successful update refreshes data, announces it and returns to the vehicle page', async () => {
		const saved: Vehicle = { ...EXISTING, model: 'Accord' };
		updateVehicle.mockResolvedValue(saved);
		appStore.setVehicles([EXISTING]);
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /update vehicle/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/veh-1'));
		expect(refreshAll).toHaveBeenCalledTimes(1);
		expect(notificationMessages()).toContain('Vehicle updated successfully!');
		expect(appStore.vehicles.find(v => v.id === 'veh-1')?.model).toBe('Accord');
	});

	test('a failed update reports an updating error and stays on the form', async () => {
		updateVehicle.mockRejectedValue(new Error('conflict'));
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /update vehicle/i }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain('Error updating vehicle. Please try again.')
		);
		expect(goto).not.toHaveBeenCalled();
		expect(refreshAll).not.toHaveBeenCalled();
	});

	test('validation also guards updates', async () => {
		await renderEdit();
		await type('make', '');

		await fireEvent.click(screen.getByRole('button', { name: /update vehicle/i }));

		expect(errorText('make')).toBe('Make is required');
		expect(updateVehicle).not.toHaveBeenCalled();
	});

	test('cancel returns to the vehicle page', async () => {
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

		expect(goto).toHaveBeenCalledWith('/vehicles/veh-1');
		expect(updateVehicle).not.toHaveBeenCalled();
	});

	test('delete asks for confirmation, then removes the vehicle and returns to the dashboard', async () => {
		deleteVehicle.mockResolvedValue(undefined);
		appStore.setVehicles([EXISTING]);
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Daily Driver');
		expect(deleteVehicle).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: /delete vehicle/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/dashboard'));
		expect(deleteVehicle).toHaveBeenCalledWith('veh-1');
		expect(appStore.vehicles).toEqual([]);
		expect(notificationMessages()).toContain('Vehicle deleted successfully');
	});

	test('a failed delete surfaces the error message and keeps the vehicle', async () => {
		deleteVehicle.mockRejectedValue(new Error('Vehicle is shared'));
		appStore.setVehicles([EXISTING]);
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		await screen.findByRole('alertdialog');
		await fireEvent.click(screen.getByRole('button', { name: /delete vehicle/i }));

		await vi.waitFor(() => expect(notificationMessages()).toContain('Vehicle is shared'));
		expect(goto).not.toHaveBeenCalled();
		expect(appStore.vehicles).toHaveLength(1);
	});
});
