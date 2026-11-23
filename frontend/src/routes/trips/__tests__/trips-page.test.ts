import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { PaginatedResponse, Trip, TripSummary, Vehicle } from '#lib/types/index.ts';
import type { TripListFilters } from '#lib/services/trip-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let formProps: Record<string, unknown> = {};
vi.mock('#lib/components/trips/TripForm.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		formProps = props;
	}
}));

const list = vi.fn<(filters?: TripListFilters) => Promise<PaginatedResponse<Trip>>>();
const getSummary = vi.fn<() => Promise<TripSummary>>();
const deleteTrip = vi.fn<(id: string, keepOdometer?: boolean) => Promise<void>>();
const getVehicles = vi.fn<() => Promise<Vehicle[]>>();

vi.mock('#lib/services/trip-api.ts', () => ({
	tripApi: {
		list: (filters?: TripListFilters) => list(filters),
		getSummary: () => getSummary(),
		delete: (id: string, keepOdometer?: boolean) => deleteTrip(id, keepOdometer)
	}
}));

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));

import Page from '../+page.svelte';

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
	...CAMRY,
	id: 'v2',
	make: 'Honda',
	model: 'Civic',
	year: 2019,
	nickname: undefined,
	unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
} as Vehicle;

const SUMMARY: TripSummary = {
	tripCount: 2,
	totalDistance: 1234,
	distanceByPurpose: { business: 900, personal: 334, commute: 0, other: 0 },
	averageTripDistance: 617.4,
	businessDistance: 900,
	businessMileageValue: 603,
	rate: 0.67
};

function trip(overrides: Partial<Trip> = {}): Trip {
	return {
		id: 't1',
		vehicleId: 'v1',
		startOdometer: 1000,
		endOdometer: 1042,
		purpose: 'business',
		tripDate: '2026-11-10',
		startLocation: null,
		endLocation: null,
		note: null,
		createdAt: '2026-11-10T12:00:00.000Z',
		updatedAt: '2026-11-10T12:00:00.000Z',
		...overrides
	};
}

function tripPage(trips: Trip[], totalCount = trips.length): PaginatedResponse<Trip> {
	return {
		data: trips,
		pagination: { totalCount, limit: 100, offset: 0, hasMore: trips.length < totalCount }
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

function cardText(id: string): string {
	return screen.getByTestId(`trip-card-${id}`).textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

let notify: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	formProps = {};
	list.mockResolvedValue(tripPage([]));
	getSummary.mockResolvedValue(SUMMARY);
	getVehicles.mockResolvedValue([CAMRY, CIVIC]);
	deleteTrip.mockResolvedValue();
	notify = vi.spyOn(appStore, 'addNotification').mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	notify.mockRestore();
});

describe('trips page load states', () => {
	test('shows skeletons while loading', async () => {
		list.mockReturnValue(new Promise(() => {}));
		const { container } = render(Page);
		await settle();

		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
		expect(list).toHaveBeenCalledWith({ limit: 100 });
	});

	test('a load failure shows one inline error with no toast, and Retry reloads', async () => {
		list.mockRejectedValueOnce(new ApiError('SQLITE_BUSY: database is locked', 500));
		list.mockResolvedValueOnce(tripPage([trip()]));
		render(Page);
		await settle();

		expect(screen.getByText("Couldn't load trips")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
		expect(notify).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(list).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId('trip-card-t1')).toBeInTheDocument();
	});

	test('a non-Error failure uses the generic message', async () => {
		getVehicles.mockRejectedValueOnce('boom');
		render(Page);
		await settle();

		expect(screen.getByText("Couldn't load trips")).toBeInTheDocument();
		expect(screen.getByText(UNEXPECTED_FAILURE_MESSAGE)).toBeInTheDocument();
	});

	test('no trips shows the empty state and Log Trip opens the form', async () => {
		render(Page);
		await settle();

		expect(screen.getByText('No trips yet')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Log Trip' }));

		expect(formProps['open']).toBe(true);
		expect(formProps['trip']).toBeNull();
	});

	test('with no vehicles the empty state asks for a vehicle first and links to Add Vehicle', async () => {
		getVehicles.mockResolvedValue([]);
		render(Page);
		await settle();

		expect(screen.getByText('Add a vehicle first')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add Vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
		expect(screen.queryByRole('button', { name: 'Log Trip' })).toBeNull();
		expect(screen.queryByText('No trips yet')).toBeNull();
	});
});

describe('trips page list', () => {
	test('shows the API summary figures', async () => {
		list.mockResolvedValue(tripPage([trip()]));
		render(Page);
		await settle();

		const card = screen.getByTestId('trip-summary-card');
		expect(within(card).getByText('Mileage Summary')).toBeInTheDocument();
		expect(card.textContent?.replace(/\s+/g, ' ')).toContain('Total 1,234 mi');
		expect(card.textContent?.replace(/\s+/g, ' ')).toContain('Business 900 mi');
		expect(card.textContent?.replace(/\s+/g, ' ')).toContain('Avg / trip 617 mi');
	});

	test('a mixed-unit fleet keeps the fraction of its converted totals', async () => {
		getSummary.mockResolvedValue({ ...SUMMARY, totalDistance: 1234.56, businessDistance: 900.4 });
		list.mockResolvedValue(tripPage([trip()]));
		render(Page);
		await settle();

		const text = screen.getByTestId('trip-summary-card').textContent?.replace(/\s+/g, ' ');
		expect(text).toContain('Total 1,234.6 mi');
		expect(text).toContain('Business 900.4 mi');
	});

	test('each trip shows purpose, date, distance from the odometer span and vehicle', async () => {
		list.mockResolvedValue(tripPage([trip({ startOdometer: 1000, endOdometer: 1042 })]));
		render(Page);
		await settle();

		expect(cardText('t1')).toBe('Business Nov 10, 2026 42 mi (1,000 → 1,042) Daily');
	});

	test('the distance unit follows the trip vehicle preferences', async () => {
		list.mockResolvedValue(
			tripPage([trip({ id: 't2', vehicleId: 'v2', startOdometer: 0, endOdometer: 15 })])
		);
		render(Page);
		await settle();

		expect(cardText('t2')).toContain('15 km');
		expect(cardText('t2')).toContain('2019 Honda Civic');
	});

	test('a trip for an unknown vehicle falls back to the global unit and a generic name', async () => {
		list.mockResolvedValue(tripPage([trip({ id: 't3', vehicleId: 'gone' })]));
		render(Page);
		await settle();

		expect(cardText('t3')).toContain('42 mi');
		expect(cardText('t3')).toContain('Vehicle');
	});

	test('locations and notes are shown when present, with a dash for a missing end', async () => {
		list.mockResolvedValue(
			tripPage([trip({ startLocation: 'Home', endLocation: null, note: 'Client visit' })])
		);
		render(Page);
		await settle();

		expect(cardText('t1')).toContain('Home → —');
		expect(cardText('t1')).toContain('Client visit');
	});

	test('a truncation note appears when the API holds more trips than were fetched', async () => {
		list.mockResolvedValue(tripPage([trip()], 250));
		render(Page);
		await settle();

		expect(screen.getByTestId('trip-list-truncation')).toHaveTextContent('Showing 1 of 250 trips');
	});

	test('no truncation note when every trip is shown', async () => {
		list.mockResolvedValue(tripPage([trip()]));
		render(Page);
		await settle();

		expect(screen.queryByTestId('trip-list-truncation')).toBeNull();
	});

	test('Edit opens the form with that trip and saving reloads the list', async () => {
		const target = trip({ id: 't9' });
		list.mockResolvedValue(tripPage([target]));
		render(Page);
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: 'Edit trip' }));

		expect(formProps['open']).toBe(true);
		expect(formProps['trip']).toEqual(target);

		(formProps['onSaved'] as () => void)();
		await settle();
		expect(list).toHaveBeenCalledTimes(2);
	});
});

describe('trips page delete', () => {
	async function openDelete(): Promise<HTMLElement> {
		list.mockResolvedValue(tripPage([trip({ id: 't5' })]));
		render(Page);
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete trip' }));
		await settle();
		return screen.getByRole('alertdialog');
	}

	test('confirming keeps the linked odometer reading by default and reloads', async () => {
		const dialog = await openDelete();
		expect(within(dialog).getByRole('checkbox')).toBeChecked();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Trip' }));
		await settle();

		expect(deleteTrip).toHaveBeenCalledWith('t5', true);
		expect(notify).toHaveBeenCalledWith({ type: 'success', message: 'Trip deleted' });
		expect(list).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});

	test('unchecking the box deletes the odometer reading too', async () => {
		const dialog = await openDelete();

		await fireEvent.click(within(dialog).getByRole('checkbox'));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Trip' }));
		await settle();

		expect(deleteTrip).toHaveBeenCalledWith('t5', false);
	});

	test('Cancel closes the dialog without deleting', async () => {
		const dialog = await openDelete();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		await settle();

		expect(deleteTrip).not.toHaveBeenCalled();
		expect(screen.queryByRole('alertdialog')).toBeNull();
	});

	test('a failed delete notifies and leaves the dialog open', async () => {
		deleteTrip.mockRejectedValue(new ApiError('Trip not found', 404));
		const dialog = await openDelete();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Trip' }));
		await settle();

		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: "Couldn't delete the trip. Trip not found."
			})
		);
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
		expect(list).toHaveBeenCalledTimes(1);
	});

	test('the confirm button reads Deleting… while the delete is in flight', async () => {
		deleteTrip.mockReturnValue(new Promise(() => {}));
		const dialog = await openDelete();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Trip' }));
		await settle();

		expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
	});
});
