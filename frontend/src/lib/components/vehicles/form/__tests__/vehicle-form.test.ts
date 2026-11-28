import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { UpdateVehicleRequest, Vehicle, VehicleFinancing } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import type { UserSettings } from '#lib/types/settings.ts';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const goto = vi.fn(() => Promise.resolve());
const refreshAll = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({
	goto,
	refreshAll,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

const getVehicle = vi.fn<(id: string) => Promise<Vehicle>>();
const getFinancing = vi.fn<(id: string) => Promise<VehicleFinancing | null>>();
const createVehicle = vi.fn<(data: Partial<Vehicle>) => Promise<Vehicle>>();
const updateVehicle = vi.fn<(id: string, data: UpdateVehicleRequest) => Promise<Vehicle>>();
const deleteVehicle = vi.fn<(id: string) => Promise<void>>();
const createFinancing =
	vi.fn<(vehicleId: string, data: Partial<VehicleFinancing>) => Promise<VehicleFinancing>>();
const payOffFinancing = vi.fn<(id: string) => Promise<VehicleFinancing>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle,
		getFinancing,
		createVehicle,
		updateVehicle,
		deleteVehicle,
		createFinancing,
		payOffFinancing
	}
}));

const VehicleForm = (await import('../VehicleForm.svelte')).default;

const EXISTING: Vehicle = {
	id: 'veh-1',
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	vehicleType: 'hybrid',
	vehicleKind: 'van',
	trackFuel: true,
	trackCharging: true,
	licensePlate: 'ABC-1234',
	nickname: 'Daily Driver',
	vin: '1HGBH41JXMN109186',
	initialMileage: 42000,
	purchasePrice: 18500,
	purchaseDate: dateOnlyToISO('2024-03-15'),
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
	await screen.findByRole('heading', { name: 'Add a vehicle' });
}

async function renderEdit(vehicle: Vehicle = EXISTING): Promise<void> {
	getVehicle.mockResolvedValue(vehicle);
	render(VehicleForm, { props: { vehicleId: vehicle.id } });
	await screen.findByRole('button', { name: /save changes/i });
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
		expect(screen.getByRole('radio', { name: 'Gas' })).toBeChecked();
		expect(switchState('trackFuel')).toBe('checked');
		expect(switchState('trackCharging')).toBe('unchecked');
		expect(screen.getByRole('button', { name: /save vehicle/i })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
	});

	test('asks for the kind right after make, model and year, with the fuel as chips', async () => {
		await renderCreate();
		const order = [...document.querySelectorAll('label[for]')].map(l => l.getAttribute('for'));
		expect(order.slice(0, 4)).toEqual(['make', 'model', 'year', 'vehicleKind']);
		expect(document.querySelector('label[for="vehicleKind"]')?.textContent?.trim()).toBe('Kind');
		const fuel = screen.getByRole('group', { name: 'Fuel' });
		expect(
			within(fuel)
				.getAllByRole('radio')
				.map(r => r.getAttribute('value'))
		).toEqual(['gas', 'electric', 'hybrid']);
	});

	test('a new vehicle is a car unless another kind is picked, and the kind is saved', async () => {
		createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1', vehicleKind: 'motorcycle' });
		await renderCreate();
		expect(document.getElementById('vehicleKind')?.textContent?.trim()).toBe('Car');
		await fillRequired();

		await choose('vehicleKind', 'Motorcycle');
		expect(document.getElementById('vehicleKind')?.textContent?.trim()).toBe('Motorcycle');
		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
		expect(createdPayload().vehicleKind).toBe('motorcycle');
		expect(createdPayload().vehicleType).toBe('gas');
	});

	test('summarises the default unit preferences while the units panel is collapsed', async () => {
		await renderCreate();

		expect(screen.getByText('Miles · Gallons (US) · kWh')).toBeTruthy();
	});

	test('blocks submit and flags make and model when both are blank', async () => {
		await renderCreate();

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		expect(errorText('make')).toBe('Make is required');
		expect(errorText('model')).toBe('Model is required');
		expect(input('make').getAttribute('aria-invalid')).toBe('true');
		expect(input('make').getAttribute('aria-describedby')).toBe('make-error');
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test('a blocked submit moves focus to the first invalid field', async () => {
		await renderCreate();

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() => expect(document.activeElement).toBe(input('make')));
	});

	test('whitespace-only make is treated as missing', async () => {
		await renderCreate();
		await type('make', '   ');
		await type('model', 'Camry');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

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

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

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

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		expect(errorText('vin')).toBe(message);
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test('a VIN error clears as soon as the VIN is corrected', async () => {
		await renderCreate();
		await fillRequired();
		await type('vin', 'BAD!');
		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));
		expect(errorText('vin')).not.toBeNull();

		await type('vin', '1HGBH41JXMN109186');

		await vi.waitFor(() => expect(errorText('vin')).toBeNull());
	});

	test('rejects a negative initial mileage', async () => {
		await renderCreate();
		await fillRequired();
		await type('initialMileage', '-5');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

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

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
		expect(createdPayload()).toEqual({
			make: 'Toyota',
			model: 'Camry',
			year: 2021,
			vehicleType: 'gas',
			vehicleKind: 'car',
			catalogModelId: null,
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

	test('a successful create adds the vehicle, announces it and returns to the Garage', async () => {
		const saved: Vehicle = { ...EXISTING, id: 'new-1', make: 'Toyota', model: 'Camry' };
		createVehicle.mockResolvedValue(saved);
		await renderCreate();
		await fillRequired();

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles'));
		expect(appStore.vehicles).toContainEqual(saved);
		expect(notificationMessages()).toContain('Vehicle added successfully!');
		expect(refreshAll).not.toHaveBeenCalled();
	});

	test('a failed create keeps the user on the form with an error notification', async () => {
		createVehicle.mockRejectedValue(new ApiError('Internal server error', 500));
		await renderCreate();
		await fillRequired();

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain(
				`Couldn't add the vehicle. ${SERVER_FAILURE_MESSAGE}`
			)
		);
		expect(goto).not.toHaveBeenCalled();
		expect(appStore.vehicles).toEqual([]);
		expect(input('make').value).toBe('Toyota');
		expect(screen.getByRole('button', { name: /save vehicle/i }).hasAttribute('disabled')).toBe(
			false
		);
	});

	test('shows a busy, disabled submit button while the create is in flight', async () => {
		let release: (v: Vehicle) => void = () => {};
		createVehicle.mockReturnValue(new Promise<Vehicle>(r => (release = r)));
		await renderCreate();
		await fillRequired();

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		const busy = await screen.findByRole('button', { name: /saving…/i });
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
			if (vehicleType === 'gas')
				await fireEvent.click(screen.getByRole('radio', { name: 'Electric' }));

			await fireEvent.click(screen.getByRole('radio', { name: label }));

			expect(screen.getByRole('radio', { name: label })).toBeChecked();
			expect(switchState('trackFuel')).toBe(trackFuel ? 'checked' : 'unchecked');
			expect(switchState('trackCharging')).toBe(trackCharging ? 'checked' : 'unchecked');
			await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));
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
		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));
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
		await fireEvent.click(screen.getByRole('button', { name: /change units/i }));

		await choose('distanceUnit', 'Kilometers');
		await choose('volumeUnit', 'Liters');

		expect(document.getElementById('distanceUnit')?.textContent?.trim()).toBe('Kilometers');
		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalled());
		expect(createdPayload().unitPreferences).toEqual({
			distanceUnit: 'kilometers',
			volumeUnit: 'liters',
			chargeUnit: 'kwh'
		});
	});

	test('cancel and the back arrow both return to the Garage without saving', async () => {
		await renderCreate();

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		await fireEvent.click(screen.getByRole('button', { name: 'Back to garage' }));

		expect(goto).toHaveBeenCalledTimes(2);
		expect(goto).toHaveBeenNthCalledWith(1, '/vehicles');
		expect(goto).toHaveBeenNthCalledWith(2, '/vehicles');
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
		expect(screen.getByRole('radio', { name: 'Hybrid' })).toBeChecked();
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

	test('a vehicle that no longer exists is reported and the user is sent to the dashboard', async () => {
		getVehicle.mockRejectedValue(new ApiError('Vehicle not found', 404));
		render(VehicleForm, { props: { vehicleId: 'gone' } });

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles'));
		expect(notificationMessages()).toContain('That vehicle no longer exists.');
	});

	test('a server failure keeps the user on the page with a Retry that reloads the vehicle', async () => {
		getVehicle.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		getVehicle.mockResolvedValueOnce(EXISTING);
		render(VehicleForm, { props: { vehicleId: EXISTING.id } });

		await screen.findByText("Couldn't load this vehicle");
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeTruthy();
		expect(screen.getByRole('heading', { level: 1, name: 'Edit vehicle' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Back to the vehicle' })).toBeTruthy();
		expect(goto).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await screen.findByDisplayValue('Honda');
		expect(getVehicle).toHaveBeenCalledTimes(2);
	});

	test('the page keeps its title while the vehicle loads', async () => {
		getVehicle.mockReturnValueOnce(new Promise(() => {}));
		render(VehicleForm, { props: { vehicleId: EXISTING.id } });

		expect(await screen.findByRole('heading', { level: 1, name: 'Edit vehicle' })).toBeTruthy();
		expect(document.getElementById('make')).toBeNull();
	});

	test('update sends edited fields and nulls for optionals the user emptied', async () => {
		updateVehicle.mockResolvedValue({ ...EXISTING, model: 'Accord' });
		await renderEdit();
		await type('model', 'Accord');
		await type('licensePlate', '');
		await type('nickname', '');

		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

		await vi.waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(1));
		expect(updateVehicle.mock.calls[0]?.[0]).toBe('veh-1');
		expect(document.getElementById('vehicleKind')?.textContent?.trim()).toBe('Van');
		expect(updatedPayload()).toEqual({
			make: 'Honda',
			model: 'Accord',
			year: 2019,
			vehicleType: 'hybrid',
			vehicleKind: 'van',
			catalogModelId: null,
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

		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/veh-1'));
		expect(refreshAll).toHaveBeenCalledTimes(1);
		expect(notificationMessages()).toContain('Vehicle updated successfully!');
		expect(appStore.vehicles.find(v => v.id === 'veh-1')?.model).toBe('Accord');
	});

	test('a failed update reports an updating error and stays on the form', async () => {
		updateVehicle.mockRejectedValue(new ApiError('Internal server error', 500));
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain(
				`Couldn't update the vehicle. ${SERVER_FAILURE_MESSAGE}`
			)
		);
		expect(goto).not.toHaveBeenCalled();
		expect(refreshAll).not.toHaveBeenCalled();
	});

	test('validation also guards updates', async () => {
		await renderEdit();
		await type('make', '');

		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

		expect(errorText('make')).toBe('Make is required');
		expect(updateVehicle).not.toHaveBeenCalled();
	});

	test('cancel returns to the vehicle page', async () => {
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

		expect(goto).toHaveBeenCalledWith('/vehicles/veh-1');
		expect(updateVehicle).not.toHaveBeenCalled();
	});

	test('delete asks for confirmation, then removes the vehicle and returns to the Garage', async () => {
		deleteVehicle.mockResolvedValue(undefined);
		appStore.setVehicles([EXISTING]);
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Daily Driver');
		expect(deleteVehicle).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: /delete vehicle/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles'));
		expect(deleteVehicle).toHaveBeenCalledWith('veh-1');
		expect(appStore.vehicles).toEqual([]);
		expect(notificationMessages()).toContain('Vehicle deleted successfully');
	});

	test('a failed delete surfaces the error message and keeps the vehicle', async () => {
		deleteVehicle.mockRejectedValue(new ApiError('Vehicle is shared with other people', 409));
		appStore.setVehicles([EXISTING]);
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		await screen.findByRole('alertdialog');
		await fireEvent.click(screen.getByRole('button', { name: /delete vehicle/i }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain(
				"Couldn't delete the vehicle. Vehicle is shared with other people."
			)
		);
		expect(goto).not.toHaveBeenCalled();
		expect(appStore.vehicles).toHaveLength(1);
	});
});

const LOAN: VehicleFinancing = {
	id: 'fin-1',
	vehicleId: 'veh-1',
	financingType: 'loan',
	provider: 'Credit Union',
	originalAmount: 20000,
	apr: 4.5,
	termMonths: 60,
	startDate: dateOnlyToISO('2024-01-15'),
	paymentAmount: 373,
	paymentFrequency: 'monthly',
	paymentDayOfMonth: 15,
	isActive: true,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};

const LEASE: VehicleFinancing = {
	...LOAN,
	financingType: 'lease',
	provider: 'Toyota Financial',
	originalAmount: 12000,
	apr: undefined,
	termMonths: 36,
	paymentAmount: 333
};

const unitChangeRejection = () =>
	new ApiError('Units changed', 400, { requiresUnitChangeConfirmation: true });

function createdFinancing(): Partial<VehicleFinancing> {
	const [, payload] = createFinancing.mock.calls.at(-1) ?? [];
	if (!payload) throw new Error('createFinancing was not called');
	return payload;
}

async function renderEditWithFinancing(
	financing: VehicleFinancing,
	vehicle: Vehicle = EXISTING
): Promise<void> {
	getFinancing.mockResolvedValue({ ...financing });
	await renderEdit(vehicle);
}

async function submitUpdate(): Promise<void> {
	await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
}

async function pickStartDate(dateValue: string): Promise<void> {
	const field = document.querySelector('label[for="startDate"]')?.parentElement;
	const trigger = field?.querySelector('button');
	if (!trigger) throw new Error('no start date trigger');
	await fireEvent.click(trigger);
	const day = await vi.waitFor(() => {
		const el = document.querySelector(`[data-bits-day][data-value="${dateValue}"]`);
		if (!(el instanceof HTMLElement)) throw new Error(`no day ${dateValue}`);
		return el;
	});
	await fireEvent.click(day);
}

describe('VehicleForm financing on create', () => {
	test('a new financed vehicle saves the loan with the computed monthly payment', async () => {
		createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		createFinancing.mockResolvedValue({ ...LOAN, vehicleId: 'new-1' });
		await renderCreate();
		await fillRequired();
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await type('provider', 'Chase');
		await type('originalAmount', '30000');
		await type('apr', '6');
		await pickStartDate('2026-06-01');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() => expect(createFinancing).toHaveBeenCalledTimes(1));
		expect(createFinancing.mock.calls[0]?.[0]).toBe('new-1');
		expect(createdFinancing()).toEqual({
			financingType: 'loan',
			provider: 'Chase',
			originalAmount: 30000,
			apr: 6,
			termMonths: 60,
			startDate: dateOnlyToISO('2026-06-01'),
			paymentAmount: 579.98,
			paymentFrequency: 'monthly',
			paymentDayOfMonth: 1
		});
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles'));
	});

	test('a new 0% APR loan saves the principal split evenly over the term', async () => {
		createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		createFinancing.mockResolvedValue({ ...LOAN, vehicleId: 'new-1' });
		await renderCreate();
		await fillRequired();
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await type('provider', 'Honda Financial');
		await type('originalAmount', '30000');
		await type('apr', '0');
		await pickStartDate('2026-06-01');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() => expect(createFinancing).toHaveBeenCalledTimes(1));
		expect(createdFinancing()).toMatchObject({ apr: 0, paymentAmount: 500 });
	});

	test('a loan with the APR cleared is not saved', async () => {
		await renderCreate();
		await fillRequired();
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await type('provider', 'Chase');
		await type('originalAmount', '30000');
		await type('apr', '');
		await pickStartDate('2026-06-01');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		expect(errorText('apr')).toBe('APR is required');
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test('a financed vehicle missing lender and start date is not saved', async () => {
		await renderCreate();
		await fillRequired();
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await type('originalAmount', '30000');
		await type('apr', '6');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		expect(errorText('provider')).toBe('Provider is required');
		expect(errorText('startDate')).toBe('Start date is required');
		expect(createVehicle).not.toHaveBeenCalled();
	});

	test('a vehicle is still added when saving its financing fails, with a warning', async () => {
		createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		createFinancing.mockRejectedValue(new ApiError('lender rejected', 500));
		await renderCreate();
		await fillRequired();
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await type('provider', 'Chase');
		await type('originalAmount', '30000');
		await type('apr', '6');
		await pickStartDate('2026-06-01');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles'));
		expect(notificationMessages()).toEqual(
			expect.arrayContaining([
				`The vehicle was saved, but its financing couldn't be saved. ${SERVER_FAILURE_MESSAGE}`,
				'Vehicle added successfully!'
			])
		);
	});

	test('a server-side unit confirmation on create re-sends the vehicle once confirmed', async () => {
		createVehicle
			.mockRejectedValueOnce(unitChangeRejection())
			.mockResolvedValueOnce({ ...EXISTING, id: 'new-1' });
		await renderCreate();
		await fillRequired();

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));
		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Change units for this vehicle?');
		expect(dialog.textContent).not.toContain("You're changing");
		expect(notificationMessages()).toEqual([]);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Change units' }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles'));
		expect(createVehicle).toHaveBeenCalledTimes(2);
		expect(createdPayload()).not.toHaveProperty('confirmUnitChange');
	});

	test('rejects a negative purchase price', async () => {
		await renderCreate();
		await fillRequired();
		await type('purchasePrice', '-1');

		await fireEvent.click(screen.getByRole('button', { name: /save vehicle/i }));

		expect(errorText('purchasePrice')).toBe('Purchase price cannot be negative');
		expect(input('purchasePrice').getAttribute('aria-describedby')).toBe('purchasePrice-error');
		expect(createVehicle).not.toHaveBeenCalled();
	});
});

describe('VehicleForm financing on edit', () => {
	beforeEach(() => {
		updateVehicle.mockResolvedValue(EXISTING);
		createFinancing.mockResolvedValue(LOAN);
	});

	test('an active lease opens as Lease and re-saves its terms without an APR', async () => {
		await renderEditWithFinancing({
			...LEASE,
			residualValue: 15000,
			mileageLimit: 12000,
			excessMileageFee: 0.25
		});

		expect(screen.getByRole('radio', { name: 'Lease' })).toBeChecked();
		expect(input('residualValue').value).toBe('15000');
		await submitUpdate();

		await vi.waitFor(() => expect(createFinancing).toHaveBeenCalledTimes(1));
		expect(createdFinancing()).toEqual({
			financingType: 'lease',
			provider: 'Toyota Financial',
			originalAmount: 12000,
			termMonths: 36,
			startDate: dateOnlyToISO('2024-01-15'),
			paymentAmount: 333,
			paymentFrequency: 'monthly',
			paymentDayOfMonth: 15,
			residualValue: 15000,
			mileageLimit: 12000,
			excessMileageFee: 0.25
		});
	});

	test('a lease without residual, mileage limit or excess fee leaves them out', async () => {
		await renderEditWithFinancing(LEASE);

		await submitUpdate();

		await vi.waitFor(() => expect(createFinancing).toHaveBeenCalledTimes(1));
		const saved = createdFinancing();
		expect(saved).not.toHaveProperty('residualValue');
		expect(saved).not.toHaveProperty('mileageLimit');
		expect(saved).not.toHaveProperty('excessMileageFee');
		expect(saved).not.toHaveProperty('apr');
	});

	test('a saved loan without a payment day defaults to the 1st', async () => {
		await renderEditWithFinancing({ ...LOAN, paymentDayOfMonth: undefined });

		expect(document.getElementById('dayOfMonth')?.textContent?.trim()).toBe('1');
		await submitUpdate();

		await vi.waitFor(() => expect(createFinancing).toHaveBeenCalledTimes(1));
		expect(createdFinancing()).toMatchObject({ paymentDayOfMonth: 1, paymentAmount: 373 });
	});

	test('a financing save failure with a non-Error reason warns with the generic sentence', async () => {
		createFinancing.mockRejectedValue('timeout');
		await renderEditWithFinancing(LOAN);

		await submitUpdate();

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/veh-1'));
		expect(notificationMessages()).toContain(
			`The vehicle was saved, but its financing couldn't be saved. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
		expect(notificationMessages()).toContain('Vehicle updated successfully!');
	});

	test('an inactive loan opens as Own and saves no financing', async () => {
		await renderEditWithFinancing({ ...LOAN, isActive: false });

		expect(screen.getByRole('switch', { name: 'This car has a loan or lease' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		expect(document.getElementById('provider')).toBeNull();
		await submitUpdate();

		await vi.waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(1));
		expect(createFinancing).not.toHaveBeenCalled();
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});

	test('an active record of type own opens as Own', async () => {
		await renderEditWithFinancing({ ...LOAN, financingType: 'own' });

		expect(screen.getByRole('switch', { name: 'This car has a loan or lease' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		expect(document.getElementById('provider')).toBeNull();
	});

	test('the payoff prompt omits the lender when the loan has none', async () => {
		await renderEditWithFinancing({ ...LOAN, provider: '' });
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await submitUpdate();

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Switching to Own marks the loan as paid off.');
	});

	test('a failed lease ending names the lease and falls back to the generic sentence', async () => {
		payOffFinancing.mockRejectedValue('offline');
		await renderEditWithFinancing(LEASE);
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await submitUpdate();

		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'End lease' }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain(
				`Couldn't mark the lease as ended. ${UNEXPECTED_FAILURE_MESSAGE}`
			)
		);
		expect(updateVehicle).not.toHaveBeenCalled();
	});
});

describe('VehicleForm edit mode unit confirmation', () => {
	test('confirming sends the update again with confirmUnitChange', async () => {
		updateVehicle.mockRejectedValueOnce(unitChangeRejection()).mockResolvedValueOnce(EXISTING);
		await renderEdit({ ...EXISTING, unitPreferences: undefined });

		await submitUpdate();
		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).not.toContain("You're changing");

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Change units' }));

		await vi.waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(2));
		expect(updatedPayload()).toMatchObject({ confirmUnitChange: true });
	});

	test('a confirmation request with no unit difference gives no conversion example', async () => {
		updateVehicle.mockRejectedValueOnce(unitChangeRejection());
		await renderEdit();

		await submitUpdate();
		const dialog = await screen.findByRole('alertdialog');

		expect(dialog.textContent).toContain('are not converted');
		expect(dialog.textContent).not.toContain('For example');
	});

	test('a second unit rejection after confirming is reported as an update error', async () => {
		updateVehicle.mockRejectedValue(unitChangeRejection());
		await renderEdit();
		await submitUpdate();
		const dialog = await screen.findByRole('alertdialog');

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Change units' }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain("Couldn't update the vehicle. Units changed.")
		);
	});
});

describe('VehicleForm edit mode delete dialog', () => {
	test('names the vehicle by year, make and model when it has no nickname', async () => {
		await renderEdit({ ...EXISTING, nickname: undefined });

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		const dialog = await screen.findByRole('alertdialog');

		expect(
			within(dialog).getByText('2019 Honda Civic', { selector: 'p.font-medium' })
		).toBeTruthy();
	});

	test('a delete failure with a non-Error reason shows the generic message', async () => {
		deleteVehicle.mockRejectedValue('nope');
		await renderEdit();
		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		await screen.findByRole('alertdialog');

		await fireEvent.click(screen.getByRole('button', { name: /delete vehicle/i }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain(
				`Couldn't delete the vehicle. ${UNEXPECTED_FAILURE_MESSAGE}`
			)
		);
		expect(goto).not.toHaveBeenCalled();
	});

	test('an update in flight counts as unsaved changes', async () => {
		updateVehicle.mockReturnValue(new Promise(() => {}));
		await renderEdit();
		expect(hasPendingSave()).toBe(false);

		await submitUpdate();

		await vi.waitFor(() => expect(hasPendingSave()).toBe(true));
	});

	test('ending a lease before the update counts as unsaved changes', async () => {
		payOffFinancing.mockReturnValue(new Promise(() => {}));
		await renderEditWithFinancing(LEASE);
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		await submitUpdate();
		const dialog = await screen.findByRole('alertdialog');

		await fireEvent.click(within(dialog).getByRole('button', { name: 'End lease' }));

		await vi.waitFor(() => expect(hasPendingSave()).toBe(true));
		expect(updateVehicle).not.toHaveBeenCalled();
	});
});

describe('VehicleForm purchase price follows the currency', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test.each([
		['JPY', '1', '0'],
		['USD', '0.01', '0.00']
	])('a %s user steps the price by %s with placeholder %s', async (unit, step, placeholder) => {
		vi.spyOn(settingsStore, 'settings', 'get').mockReturnValue({
			currencyUnit: unit
		} as UserSettings);
		await renderCreate();
		expect(input('purchasePrice')).toHaveAttribute('step', step);
		expect(input('purchasePrice')).toHaveAttribute('placeholder', placeholder);
	});
});
