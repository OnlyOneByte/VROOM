import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

const { addNotification, getVehicles, getVehicle, getExpensesByVehicle } = vi.hoisted(() => ({
	addNotification: vi.fn(),
	getVehicles: vi.fn(),
	getVehicle: vi.fn<() => Promise<unknown>>(() => Promise.reject(new TypeError('Failed to fetch'))),
	getExpensesByVehicle: vi.fn<() => Promise<unknown>>(() =>
		Promise.reject(new TypeError('Failed to fetch'))
	)
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));
vi.mock('#lib/stores/app.svelte.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/stores/app.svelte.ts')>();
	return { appStore: Object.assign(actual.appStore, { addNotification }) };
});
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicles, getVehicle } }));
vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: { getExpensesByVehicle } }));

const { onlineStatus } = await import('#lib/stores/offline.svelte.ts');
const { setOfflineQueueOwner } = await import('#lib/utils/offline-storage.ts');
const ExpenseForm = (await import('../ExpenseForm.svelte')).default;
const { offlineExpenseQueue } = await import('#lib/stores/offline.svelte.ts');
const { loadAllVehicleExpenses, loadVehicleContext } =
	await import('../expense-form/expense-form-loaders.ts');
type FormState = import('../expense-form/expense-form-state.svelte').ExpenseFormState;

function fakeState(vehicleId: string): FormState {
	const always = () => () => true;
	return {
		formData: { vehicleId },
		ctx: { expenseId: undefined },
		vehicle: null,
		vehicleError: null,
		lastFuelExpense: null,
		allVehicleExpenses: [],
		nextContextRequest: always,
		nextVehicleRequest: always,
		nextLastFuelRequest: always,
		nextHistoryRequest: always
	} as unknown as FormState;
}

const CAMRY = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'car',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const storage = new Map<string, string>();
const localStorageMock = window.localStorage as unknown as {
	getItem: ReturnType<typeof vi.fn>;
	setItem: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
	vi.clearAllMocks();
	storage.clear();
	localStorageMock.getItem.mockImplementation((key: string) => storage.get(key) ?? null);
	localStorageMock.setItem.mockImplementation((key: string, value: string) => {
		storage.set(key, value);
	});
	setOfflineQueueOwner('u1');
});

afterEach(() => {
	onlineStatus.current = true;
	setOfflineQueueOwner(null);
});

describe('the expense form offline', () => {
	test('opens with the cached vehicles, without an error', async () => {
		storage.set('vroom_offline_vehicles:u1', JSON.stringify([CAMRY]));
		storage.set('vroom_offline_vehicle_history:v1:u1', JSON.stringify([]));
		onlineStatus.current = false;
		getVehicles.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		render(ExpenseForm);

		expect(await screen.findByText(/2020 Toyota Camry/)).toBeInTheDocument();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(screen.queryByTestId('vehicles-load-error')).not.toBeInTheDocument();
		expect(screen.queryByTestId('vehicle-load-error')).not.toBeInTheDocument();
		expect(addNotification).not.toHaveBeenCalled();
	});

	test('online, a failed load still reports the error even with a cache', async () => {
		storage.set('vroom_offline_vehicles:u1', JSON.stringify([CAMRY]));
		getVehicles.mockRejectedValueOnce(new Error('boom'));

		render(ExpenseForm);

		expect(await screen.findByTestId('vehicles-load-error')).toBeInTheDocument();
	});

	test('offline, the mileage check uses the cached history plus queued fill-ups', async () => {
		storage.set('vroom_offline_vehicles:u1', JSON.stringify([CAMRY]));
		storage.set(
			'vroom_offline_vehicle_history:v1:u1',
			JSON.stringify([
				{ id: 'e1', vehicleId: 'v1', date: '2024-03-01T12:00:00.000Z', mileage: 45000 }
			])
		);
		offlineExpenseQueue.current = [
			{
				id: 'q1',
				vehicleId: 'v1',
				tags: [],
				category: 'fuel',
				amount: 40,
				date: '2024-03-10',
				mileage: 45500,
				timestamp: 1,
				synced: false
			}
		];
		onlineStatus.current = false;
		const state = fakeState('v1');

		await loadVehicleContext(state);

		expect(state.allVehicleExpenses.map(expense => expense.mileage)).toEqual([45000, 45500]);
		expect(state.vehicleError).toBeNull();
		offlineExpenseQueue.current = [];
	});

	test('offline without a cached history, the cached vehicle is kept but reported as not fully loaded', async () => {
		storage.set('vroom_offline_vehicles:u1', JSON.stringify([CAMRY]));
		onlineStatus.current = false;
		const state = fakeState('v1');

		await loadVehicleContext(state);

		expect(state.vehicle?.id).toBe('v1');
		expect(state.vehicleError).not.toBeNull();
	});

	test('a history that arrives after the account changed is not cached for the new account', async () => {
		let reply!: (value: unknown) => void;
		getExpensesByVehicle.mockReturnValueOnce(new Promise(resolve => (reply = resolve)));
		const state = fakeState('v1');
		const pending = loadAllVehicleExpenses(state);
		setOfflineQueueOwner('u2');
		reply({ data: [{ id: 'e1', vehicleId: 'v1', date: '2024-03-01', mileage: 1 }] });
		await pending;

		expect(storage.has('vroom_offline_vehicle_history:v1:u2')).toBe(false);
		expect(storage.has('vroom_offline_vehicle_history:v1:u1')).toBe(false);
	});

	test("never reads another user's cached vehicles", async () => {
		storage.set('vroom_offline_vehicles:someone-else', JSON.stringify([CAMRY]));
		onlineStatus.current = false;
		getVehicles.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		render(ExpenseForm);

		expect(await screen.findByTestId('vehicles-load-error')).toBeInTheDocument();
	});
});
