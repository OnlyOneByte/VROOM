import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Expense, Vehicle } from '#lib/types/index.ts';
import { makeExpense, makeVehicle } from './expense-form-fixtures';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const { expenseApiMock, vehicleApiMock, addNotification } = vi.hoisted(() => ({
	expenseApiMock: { getExpensesByVehicle: vi.fn() },
	vehicleApiMock: { getVehicles: vi.fn(), getVehicle: vi.fn() },
	addNotification: vi.fn()
}));

vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: expenseApiMock }));
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: vehicleApiMock }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification } }));

const { ExpenseFormState } = await import('../expense-form-state.svelte');
const {
	loadAllVehicleExpenses,
	loadLastFuelExpense,
	loadVehicle,
	loadVehicleContext,
	loadVehicles
} = await import('../expense-form-loaders');

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createState() {
	return new ExpenseFormState({ expenseId: undefined, returnTo: '/expenses' }, false);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('expense form loader failures are reported', () => {
	test('a failed vehicle list sets an inline error and a toast; a retry clears it', async () => {
		vehicleApiMock.getVehicles.mockRejectedValueOnce(new Error('offline'));
		const state = createState();
		await loadVehicles(state);
		expect(state.vehiclesError).toBe('Offline.');
		expect(addNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: 'Failed to load vehicles. Offline.'
			})
		);

		vehicleApiMock.getVehicles.mockResolvedValueOnce([makeVehicle('v1')]);
		await loadVehicles(state);
		expect(state.vehiclesError).toBeNull();
		expect(state.formData.vehicleId).toBe('v1');
	});

	test('a failed vehicle load clears the previous vehicle and reports it once', async () => {
		const state = createState();
		state.vehicle = makeVehicle('v1');
		state.allVehicleExpenses = [makeExpense('old')];
		state.formData.vehicleId = 'v2';
		vehicleApiMock.getVehicle.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		expenseApiMock.getExpensesByVehicle.mockResolvedValue({ data: [] });
		await loadVehicleContext(state);
		expect(state.vehicle).toBeNull();
		expect(state.allVehicleExpenses).toEqual([]);
		expect(state.vehicleError).toBe(SERVER_FAILURE_MESSAGE);
		expect(addNotification).toHaveBeenCalledTimes(1);
	});

	test('a full outage raises one toast per vehicle load, and a retry clears the error', async () => {
		const state = createState();
		state.formData.vehicleId = 'v1';
		state.allVehicleExpenses = [makeExpense('old')];
		vehicleApiMock.getVehicle.mockRejectedValueOnce(new Error('offline'));
		expenseApiMock.getExpensesByVehicle
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new Error('offline'));
		await loadVehicleContext(state);
		expect(state.allVehicleExpenses).toEqual([]);
		expect(addNotification).toHaveBeenCalledTimes(1);
		expect(addNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: "Failed to load this vehicle's details. Offline."
			})
		);

		vehicleApiMock.getVehicle.mockResolvedValueOnce(makeVehicle('v1'));
		expenseApiMock.getExpensesByVehicle.mockResolvedValue({ data: [] });
		await loadVehicleContext(state);
		expect(state.vehicleError).toBeNull();
		expect(addNotification).toHaveBeenCalledTimes(1);
	});
});

describe('a thrown non-Error value', () => {
	test('reads as the generic sentence, never as [object Object]', async () => {
		const state = createState();
		state.formData.vehicleId = 'v1';
		vehicleApiMock.getVehicle.mockRejectedValueOnce({ status: 'weird' });
		expenseApiMock.getExpensesByVehicle.mockResolvedValue({ data: [] });
		await loadVehicleContext(state);
		expect(state.vehicleError).toBe(UNEXPECTED_FAILURE_MESSAGE);
		const toast = addNotification.mock.calls[0]?.[0] as { message: string } | undefined;
		expect(toast?.message).toBe(
			`Failed to load this vehicle's details. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
		expect(JSON.stringify(addNotification.mock.calls)).not.toContain('[object Object]');
	});
});

describe('switching vehicles keeps only the latest response', () => {
	test('a slow response for the previous vehicle does not overwrite the new one', async () => {
		const first = deferred<Vehicle>();
		const second = deferred<Vehicle>();
		vehicleApiMock.getVehicle
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const state = createState();
		state.formData.vehicleId = 'v1';
		const p1 = loadVehicle(state);
		state.formData.vehicleId = 'v2';
		const p2 = loadVehicle(state);
		second.resolve(makeVehicle('v2'));
		await p2;
		first.resolve(makeVehicle('v1'));
		await p1;
		expect(state.vehicle?.id).toBe('v2');
	});

	test('a late failure for the previous vehicle is ignored', async () => {
		const first = deferred<Vehicle>();
		vehicleApiMock.getVehicle
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(makeVehicle('v2'));
		const state = createState();
		const p1 = loadVehicle(state);
		await loadVehicle(state);
		first.reject(new Error('stale'));
		await p1;
		expect(state.vehicle?.id).toBe('v2');
	});

	test("an older vehicle's history does not replace the newer one", async () => {
		const first = deferred<{ data: Expense[] }>();
		expenseApiMock.getExpensesByVehicle
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce({ data: [makeExpense('new')] });
		const state = createState();
		const p1 = loadAllVehicleExpenses(state);
		await loadAllVehicleExpenses(state);
		first.resolve({ data: [makeExpense('old')] });
		await p1;
		expect(state.allVehicleExpenses.map(e => e.id)).toEqual(['new']);
	});

	test("an older vehicle's last fill-up does not replace the newer one", async () => {
		const first = deferred<{ data: Expense[] }>();
		expenseApiMock.getExpensesByVehicle
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce({ data: [makeExpense('new-fill')] });
		const state = createState();
		const p1 = loadLastFuelExpense(state);
		await loadLastFuelExpense(state);
		first.resolve({ data: [makeExpense('old-fill')] });
		await p1;
		expect(state.lastFuelExpense?.id).toBe('new-fill');
	});

	test('a late failure from an older vehicle context does not set an error', async () => {
		const slow = deferred<Vehicle>();
		vehicleApiMock.getVehicle
			.mockReturnValueOnce(slow.promise)
			.mockResolvedValueOnce(makeVehicle('v2'));
		expenseApiMock.getExpensesByVehicle.mockResolvedValue({ data: [] });
		const state = createState();
		const p1 = loadVehicleContext(state);
		await loadVehicleContext(state);
		slow.reject(new Error('stale'));
		await p1;
		expect(state.vehicleError).toBeNull();
		expect(addNotification).not.toHaveBeenCalled();
	});

	test('overlapping vehicle loads still report a failure of the newest one', async () => {
		const slowVehicle = deferred<Vehicle>();
		vehicleApiMock.getVehicle
			.mockReturnValueOnce(slowVehicle.promise)
			.mockResolvedValueOnce(makeVehicle('v2'));
		expenseApiMock.getExpensesByVehicle
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: [] })
			.mockRejectedValueOnce(new Error('expenses down'))
			.mockResolvedValueOnce({ data: [] });
		const state = createState();
		const p1 = loadVehicleContext(state);
		const p2 = loadVehicleContext(state);
		slowVehicle.resolve(makeVehicle('v1'));
		await Promise.all([p1, p2]);
		expect(state.vehicle?.id).toBe('v2');
		expect(state.vehicleError).toBe('Expenses down.');
		expect(addNotification).toHaveBeenCalledTimes(1);
	});
});
