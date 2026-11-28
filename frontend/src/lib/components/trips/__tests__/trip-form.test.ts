import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { Driver, Trip, Vehicle } from '#lib/types/index.ts';
import type { CreateTripRequest, UpdateTripRequest } from '#lib/services/trip-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';

const create = vi.fn<(data: CreateTripRequest) => Promise<Trip>>();
const update = vi.fn<(id: string, data: UpdateTripRequest) => Promise<Trip>>();

const listDrivers = vi.fn<(vehicleId: string) => Promise<Driver[] | null>>();

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: { list: (vehicleId: string) => listDrivers(vehicleId) }
}));

vi.mock('#lib/services/trip-api.ts', () => ({
	tripApi: {
		create: (data: CreateTripRequest) => create(data),
		update: (id: string, data: UpdateTripRequest) => update(id, data)
	}
}));

import TripForm from '../TripForm.svelte';

const TODAY = new Date(2026, 10, 21, 9, 0, 0);

const CAMRY = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	nickname: 'Daily',
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
} as Vehicle;

const CIVIC = {
	id: 'v2',
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
} as Vehicle;

function trip(overrides: Partial<Trip> = {}): Trip {
	return {
		id: 't1',
		vehicleId: 'v2',
		startOdometer: 1000,
		endOdometer: 1042,
		purpose: 'commute',
		tripDate: new Date(2026, 10, 10, 12, 0, 0).toISOString(),
		startLocation: 'Home',
		endLocation: 'Office',
		note: 'Client visit',
		createdAt: '2026-11-10T12:00:00.000Z',
		updatedAt: '2026-11-10T12:00:00.000Z',
		...overrides
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

const onSaved = vi.fn<() => void>();

function mount(props: { vehicles?: Vehicle[]; trip?: Trip | null; open?: boolean } = {}) {
	return render(TripForm, {
		props: {
			open: props.open ?? true,
			vehicles: props.vehicles ?? [CAMRY, CIVIC],
			trip: props.trip ?? null,
			onSaved
		}
	});
}

function field(id: string): HTMLInputElement {
	return document.getElementById(id) as HTMLInputElement;
}

async function pickOption(triggerId: string, optionName: string): Promise<void> {
	await fireEvent.click(field(triggerId));
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name: optionName }));
	await settle();
}

async function typeOdometers(start: string, end: string): Promise<void> {
	await fireEvent.input(field('trip-start'), { target: { value: start } });
	await fireEvent.input(field('trip-end'), { target: { value: end } });
}

async function submit(): Promise<void> {
	await fireEvent.submit(field('trip-start').closest('form') as HTMLFormElement);
	await settle();
}

let notify: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(TODAY);
	vi.clearAllMocks();
	create.mockResolvedValue(trip());
	update.mockResolvedValue(trip());
	listDrivers.mockResolvedValue(null);
	notify = vi.spyOn(appStore, 'addNotification').mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	notify.mockRestore();
	vi.useRealTimers();
});

describe('TripForm create mode', () => {
	test('opens titled Log a trip with business purpose and no vehicle chosen', async () => {
		mount();
		await settle();

		expect(screen.getByRole('heading', { name: 'Log a trip' })).toBeInTheDocument();
		expect(field('trip-vehicle')).toHaveTextContent('Select a vehicle');
		expect(field('trip-purpose')).toHaveTextContent('Business');
		expect(screen.getByRole('button', { name: 'Log trip' })).toBeEnabled();
	});

	test('a single vehicle is preselected', async () => {
		mount({ vehicles: [CAMRY] });
		await settle();

		expect(field('trip-vehicle')).toHaveTextContent('Daily');
	});

	test('without vehicles it asks for a vehicle first and disables submit', async () => {
		mount({ vehicles: [] });
		await settle();

		expect(screen.getByText('Add a vehicle first to log a trip.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Log trip' })).toBeDisabled();
	});

	test('the odometer unit follows the chosen vehicle', async () => {
		mount();
		await settle();

		expect(screen.getAllByText('mi')).toHaveLength(2);

		await pickOption('trip-vehicle', '2019 Honda Civic');

		expect(screen.getAllByText('km')).toHaveLength(2);
	});
});

describe('TripForm validation', () => {
	test('an empty form reports vehicle and both odometers and saves nothing', async () => {
		mount();
		await settle();

		await submit();

		expect(screen.getByText('Select a vehicle', { selector: 'p' })).toBeInTheDocument();
		expect(screen.getByText('Enter a valid start odometer')).toBeInTheDocument();
		expect(screen.getByText('Enter a valid end odometer')).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});

	test('an end reading below the start reading is rejected', async () => {
		mount({ vehicles: [CAMRY] });
		await settle();

		await typeOdometers('1200', '1100');
		await submit();

		expect(
			screen.getByText('End odometer must be at least the start odometer')
		).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});

	test('a trip dated in the future is rejected', async () => {
		mount({ trip: trip({ tripDate: new Date(2026, 10, 25, 12).toISOString() }) });
		await settle();

		await submit();

		expect(screen.getByText('Trip date cannot be in the future')).toBeInTheDocument();
		expect(update).not.toHaveBeenCalled();
	});

	test('the trip date picker is marked invalid and described by its error', async () => {
		mount({ trip: trip({ tripDate: new Date(2026, 10, 25, 12).toISOString() }) });
		await settle();

		await submit();

		const picker = field('trip-date');
		expect(picker.getAttribute('aria-invalid')).toBe('true');
		expect(picker).toHaveAccessibleDescription(
			'November 25, 2026 Trip date cannot be in the future'
		);
	});

	test('over-long locations and notes are rejected', async () => {
		mount({ vehicles: [CAMRY] });
		await settle();

		await typeOdometers('1', '2');
		await fireEvent.input(field('trip-start-loc'), { target: { value: 'a'.repeat(201) } });
		await fireEvent.input(field('trip-end-loc'), { target: { value: 'b'.repeat(201) } });
		await fireEvent.input(field('trip-note'), { target: { value: 'c'.repeat(501) } });
		await submit();

		expect(screen.getByText('Start location is too long (max 200)')).toBeInTheDocument();
		expect(screen.getByText('End location is too long (max 200)')).toBeInTheDocument();
		expect(screen.getByText('Note is too long (max 500)')).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});
});

describe('TripForm create submit', () => {
	test('logs the trip with the chosen vehicle, purpose and trimmed text fields', async () => {
		mount();
		await settle();

		await pickOption('trip-vehicle', 'Daily');
		await pickOption('trip-purpose', 'Personal');
		await typeOdometers('1000', '1042');
		await fireEvent.input(field('trip-start-loc'), { target: { value: '  Home ' } });
		await fireEvent.input(field('trip-end-loc'), { target: { value: '   ' } });
		await fireEvent.input(field('trip-note'), { target: { value: ' Groceries ' } });
		await submit();

		expect(create).toHaveBeenCalledWith({
			vehicleId: 'v1',
			startOdometer: 1000,
			endOdometer: 1042,
			purpose: 'personal',
			tripDate: new Date(2026, 10, 21, 12, 0, 0).toISOString(),
			startLocation: 'Home',
			endLocation: undefined,
			note: 'Groceries'
		});
		expect(notify).toHaveBeenCalledWith({ type: 'success', message: 'Trip logged' });
		expect(onSaved).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	test('each purpose can be selected', async () => {
		mount();
		await settle();

		for (const label of ['Personal', 'Commute', 'Other', 'Business']) {
			await pickOption('trip-purpose', label);
			expect(field('trip-purpose')).toHaveTextContent(label);
		}
	});

	test('a failed create keeps the dialog open and reports the failure', async () => {
		create.mockRejectedValue(new ApiError('SQLITE_BUSY', 500));
		mount({ vehicles: [CAMRY] });
		await settle();

		await typeOdometers('10', '20');
		await submit();

		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: `Couldn't log the trip. ${SERVER_FAILURE_MESSAGE}`
			})
		);
		expect(onSaved).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Log trip' })).toBeEnabled();
	});

	test('the submit button reads Logging… and both buttons disable while saving', async () => {
		create.mockReturnValue(new Promise(() => {}));
		mount({ vehicles: [CAMRY] });
		await settle();

		await typeOdometers('10', '20');
		await submit();

		expect(screen.getByRole('button', { name: /Logging/ })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});

	test('Cancel closes the dialog without saving', async () => {
		mount();
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await settle();

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(create).not.toHaveBeenCalled();
	});

	test('reopening resets fields typed in a previous session', async () => {
		const view = mount({ vehicles: [CAMRY] });
		await settle();

		await typeOdometers('10', '5');
		await submit();
		expect(
			screen.getByText('End odometer must be at least the start odometer')
		).toBeInTheDocument();

		await view.rerender({ open: false });
		await settle();
		await view.rerender({ open: true });
		await settle();

		expect(field('trip-start').value).toBe('');
		expect(screen.queryByText('End odometer must be at least the start odometer')).toBeNull();
	});
});

describe('TripForm edit mode', () => {
	test('prefills every field from the trip and locks the vehicle', async () => {
		mount({ trip: trip() });
		await settle();

		expect(screen.getByRole('heading', { name: 'Edit trip' })).toBeInTheDocument();
		expect(field('trip-vehicle')).toBeDisabled();
		expect(field('trip-vehicle').value).toBe('2019 Honda Civic');
		expect(field('trip-start').value).toBe('1000');
		expect(field('trip-end').value).toBe('1042');
		expect(field('trip-purpose')).toHaveTextContent('Commute');
		expect(field('trip-start-loc').value).toBe('Home');
		expect(field('trip-end-loc').value).toBe('Office');
		expect(field('trip-note').value).toBe('Client visit');
		expect(screen.getAllByText('km')).toHaveLength(2);
	});

	test('missing optional fields prefill as empty', async () => {
		mount({ trip: trip({ startLocation: null, endLocation: null, note: null }) });
		await settle();

		expect(field('trip-start-loc').value).toBe('');
		expect(field('trip-end-loc').value).toBe('');
		expect(field('trip-note').value).toBe('');
	});

	test('an edit for a vehicle not in the list still shows a name', async () => {
		mount({ trip: trip({ vehicleId: 'gone' }) });
		await settle();

		expect(field('trip-vehicle').value).toBe('Unknown vehicle');
	});

	test('saving sends the update without a vehicle id', async () => {
		mount({ trip: trip() });
		await settle();

		await fireEvent.input(field('trip-end'), { target: { value: '1100' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save trip' }));
		await settle();

		expect(update).toHaveBeenCalledWith('t1', {
			startOdometer: 1000,
			endOdometer: 1100,
			purpose: 'commute',
			tripDate: new Date(2026, 10, 10, 12, 0, 0).toISOString(),
			startLocation: 'Home',
			endLocation: 'Office',
			note: 'Client visit'
		});
		expect(create).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith({ type: 'success', message: 'Trip updated' });
		expect(onSaved).toHaveBeenCalledTimes(1);
	});

	test('emptied optional fields are cleared on save', async () => {
		mount({ trip: trip() });
		await settle();

		await fireEvent.input(field('trip-start-loc'), { target: { value: '' } });
		await fireEvent.input(field('trip-end-loc'), { target: { value: '  ' } });
		await fireEvent.input(field('trip-note'), { target: { value: '' } });
		await submit();

		expect(update).toHaveBeenCalledWith(
			't1',
			expect.objectContaining({ startLocation: null, endLocation: null, note: null })
		);
	});

	test('a failed update reports the update failure', async () => {
		update.mockRejectedValue(new ApiError('Odometer must increase', 400));
		mount({ trip: trip() });
		await settle();

		await submit();

		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: "Couldn't update the trip. Odometer must increase."
			})
		);
		expect(onSaved).not.toHaveBeenCalled();
	});

	test('the submit button reads Saving… while the update is in flight', async () => {
		update.mockReturnValue(new Promise(() => {}));
		mount({ trip: trip() });
		await settle();

		await submit();

		expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
	});

	test('a save in flight counts as unsaved changes until the form closes', async () => {
		create.mockReturnValue(new Promise(() => {}));
		const { unmount } = mount({ vehicles: [CAMRY] });
		await settle();
		expect(hasPendingSave()).toBe(false);

		await typeOdometers('10', '20');
		await submit();

		expect(hasPendingSave()).toBe(true);
		unmount();
		expect(hasPendingSave()).toBe(false);
	});
});

describe('TripForm driver chip', () => {
	const SHARED = {
		...CIVIC,
		carShareEnabled: true,
		carShare: { enabled: true, manage: false, record: true }
	} as Vehicle;
	const DRIVERS: Driver[] = [
		{ id: 'd-sam', guest: false, name: 'Sam', color: 'chart-2', archived: false },
		{ id: 'd-riley', guest: true, name: 'Riley', color: null, archived: false }
	];

	test('an unchanged edit keeps the trip credited to its driver', async () => {
		listDrivers.mockResolvedValue(DRIVERS);
		mount({ vehicles: [CAMRY, SHARED], trip: trip({ driverId: 'd-sam' }) });
		await settle();
		expect(screen.getByRole('combobox', { name: 'Driver: Sam' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Save trip' }));
		await settle();
		expect(update.mock.calls[0]?.[1]).not.toHaveProperty('driverId');
	});

	test.each([
		['a car without car sharing', CIVIC],
		[
			'someone who may not record drivers',
			{ ...SHARED, carShare: { enabled: true, manage: false, record: false } } as Vehicle
		]
	])('%s gets no chip and no drivers request', async (_case, vehicle) => {
		mount({ vehicles: [CAMRY, vehicle], trip: trip() });
		await settle();
		expect(listDrivers).not.toHaveBeenCalled();
		expect(document.getElementById('trip-driver')).toBeNull();
	});
});
