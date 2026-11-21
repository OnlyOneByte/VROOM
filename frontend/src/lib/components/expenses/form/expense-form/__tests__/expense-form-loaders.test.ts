import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Expense } from '#lib/types/index.ts';
import { makeExpense, makeSplitGroup, makeVehicle } from './expense-form-fixtures';
import {
	ApiError,
	NETWORK_FAILURE_MESSAGE,
	NetworkError,
	SERVER_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const { expenseApiMock, vehicleApiMock, addNotification, gotoDynamic } = vi.hoisted(() => ({
	expenseApiMock: {
		getExpense: vi.fn(),
		getSplitExpense: vi.fn(),
		getExpensesByVehicle: vi.fn()
	},
	vehicleApiMock: {
		getVehicles: vi.fn(),
		getVehicle: vi.fn()
	},
	addNotification: vi.fn(),
	gotoDynamic: vi.fn(() => Promise.resolve())
}));

vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: expenseApiMock }));
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: vehicleApiMock }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification } }));
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic }));

const { ExpenseFormState } = await import('../expense-form-state.svelte');
const {
	applyPreselections,
	loadAllVehicleExpenses,
	loadExpense,
	loadLastFuelExpense,
	loadVehicle,
	loadVehicleContext,
	loadVehicles
} = await import('../expense-form-loaders');

function createState(expenseId?: string) {
	return new ExpenseFormState({ expenseId, returnTo: '/expenses' }, !!expenseId);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadVehicles', () => {
	test('stores the vehicles and preselects the first one for a new expense', async () => {
		vehicleApiMock.getVehicles.mockResolvedValue([makeVehicle('v1'), makeVehicle('v2')]);
		const state = createState();
		await loadVehicles(state);
		expect(state.vehicles.map(v => v.id)).toEqual(['v1', 'v2']);
		expect(state.formData.vehicleId).toBe('v1');
	});

	test('keeps an already chosen vehicle', async () => {
		vehicleApiMock.getVehicles.mockResolvedValue([makeVehicle('v1'), makeVehicle('v2')]);
		const state = createState();
		state.formData.vehicleId = 'v2';
		await loadVehicles(state);
		expect(state.formData.vehicleId).toBe('v2');
	});

	test('does not preselect in edit mode', async () => {
		vehicleApiMock.getVehicles.mockResolvedValue([makeVehicle('v1')]);
		const state = createState('e1');
		await loadVehicles(state);
		expect(state.formData.vehicleId).toBe('');
	});

	test('leaves the vehicle empty when the user has no vehicles', async () => {
		vehicleApiMock.getVehicles.mockResolvedValue([]);
		const state = createState();
		await loadVehicles(state);
		expect(state.formData.vehicleId).toBe('');
	});

	test('swallows a load failure and keeps the vehicle list empty', async () => {
		vehicleApiMock.getVehicles.mockRejectedValue(new Error('offline'));
		const state = createState();
		await expect(loadVehicles(state)).resolves.toBeUndefined();
		expect(state.vehicles).toEqual([]);
	});
});

describe('applyPreselections', () => {
	test('copies every provided value into the form and parses tags', () => {
		const state = createState();
		applyPreselections(state, {
			vehicleId: 'v9',
			category: 'maintenance',
			amount: '19.99',
			description: 'Oil change',
			tags: 'oil,service'
		});
		expect(state.formData).toMatchObject({
			vehicleId: 'v9',
			category: 'maintenance',
			amount: '19.99',
			description: 'Oil change'
		});
		expect(state.formData.tags).toEqual(['oil', 'service']);
	});

	test('ignores null values', () => {
		const state = createState();
		applyPreselections(state, {
			vehicleId: null,
			category: null,
			amount: null,
			description: null,
			tags: null
		});
		expect(state.formData.vehicleId).toBe('');
		expect(state.formData.category).toBe('');
		expect(state.formData.tags).toEqual([]);
	});
});

describe('loadExpense — single expense', () => {
	test('populates every form field from the stored expense', async () => {
		const expense = makeExpense('e1', {
			vehicleId: 'v2',
			tags: ['fuel'],
			amount: 55.25,
			mileage: 12_345,
			volume: 10.5,
			charge: 3,
			fuelType: 'Regular',
			description: 'Fill up',
			location: 'Shell',
			missedFillup: true
		});
		expenseApiMock.getExpense.mockResolvedValue(expense);
		const state = createState('e1');
		await loadExpense(state);
		expect(state.originalExpense).toEqual(expense);
		expect(state.formData).toMatchObject({
			vehicleId: 'v2',
			tags: ['fuel'],
			category: 'fuel',
			amount: '55.25',
			mileage: '12345',
			volume: '10.5',
			charge: '3',
			fuelType: 'Regular',
			description: 'Fill up',
			location: 'Shell',
			missedFillup: true
		});
		expect(state.formData.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(state.isLoading).toBe(false);
	});

	test('defaults optional fields to empty values', async () => {
		const expense = makeExpense('e1', { tags: undefined as unknown as string[] });
		expenseApiMock.getExpense.mockResolvedValue(expense);
		const state = createState('e1');
		await loadExpense(state);
		expect(state.formData).toMatchObject({
			tags: [],
			mileage: '',
			volume: '',
			charge: '',
			fuelType: '',
			description: '',
			location: '',
			missedFillup: false
		});
	});

	test('a deleted expense (404) says it no longer exists and navigates back', async () => {
		expenseApiMock.getExpense.mockRejectedValue(new ApiError('Expense not found', 404));
		const state = createState('e404');
		await loadExpense(state);
		expect(addNotification).toHaveBeenCalledWith({
			type: 'error',
			message: 'That expense no longer exists.'
		});
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
		expect(state.expenseError).toBeNull();
		expect(state.isLoading).toBe(false);
	});

	test('a server failure stays on the page with an inline error; a retry clears it', async () => {
		expenseApiMock.getExpense.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		const state = createState('e1');
		await loadExpense(state);
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(state.expenseError).toBe(SERVER_FAILURE_MESSAGE);
		expect(addNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: `Couldn't load this expense. ${SERVER_FAILURE_MESSAGE}`
			})
		);
		expect(state.isLoading).toBe(false);

		expenseApiMock.getExpense.mockResolvedValueOnce(makeExpense('e1', { vehicleId: 'v1' }));
		await loadExpense(state);
		expect(state.expenseError).toBeNull();
		expect(state.formData.vehicleId).toBe('v1');
		expect(gotoDynamic).not.toHaveBeenCalled();
	});

	test('a network failure stays on the page with an inline error', async () => {
		expenseApiMock.getExpense.mockRejectedValue(new NetworkError(new TypeError('fetch failed')));
		const state = createState('e1');
		await loadExpense(state);
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(state.expenseError).toBe(NETWORK_FAILURE_MESSAGE);
	});
});

describe('loadExpense — split groups', () => {
	test('a regular split group enters group-edit mode with the split state applied', async () => {
		const siblings: Expense[] = [
			makeExpense('s1', {
				vehicleId: 'v1',
				amount: 30,
				groupId: 'g1',
				category: 'maintenance',
				tags: ['tires'],
				description: 'Tires'
			}),
			makeExpense('s2', { vehicleId: 'v2', amount: 70, groupId: 'g1' })
		];
		expenseApiMock.getExpense.mockResolvedValue(siblings[0]);
		expenseApiMock.getSplitExpense.mockResolvedValue(
			makeSplitGroup(siblings, { splitMethod: 'absolute' })
		);
		const state = createState('s1');
		await loadExpense(state);
		expect(expenseApiMock.getSplitExpense).toHaveBeenCalledWith('g1');
		expect(state.groupId).toBe('g1');
		expect(state.isGroupEditMode).toBe(true);
		expect(state.isSplit).toBe(true);
		expect(state.formData).toMatchObject({
			category: 'maintenance',
			amount: '100',
			tags: ['tires'],
			description: 'Tires'
		});
		expect(state.splitMethod).toBe('absolute');
		expect(state.selectedVehicleIds).toEqual(['v1', 'v2']);
		expect(state.splitAllocations).toEqual([
			{ vehicleId: 'v1', amount: 30 },
			{ vehicleId: 'v2', amount: 70 }
		]);
		expect(state.isLoading).toBe(false);
	});

	test('a split sibling without tags or description falls back to empty values', async () => {
		const first = makeExpense('s1', {
			groupId: 'g1',
			tags: undefined as unknown as string[],
			description: undefined
		});
		expenseApiMock.getExpense.mockResolvedValue(first);
		expenseApiMock.getSplitExpense.mockResolvedValue(makeSplitGroup([first]));
		const state = createState('s1');
		await loadExpense(state);
		expect(state.formData.tags).toEqual([]);
		expect(state.formData.description).toBe('');
		expect(state.isGroupEditMode).toBe(true);
	});

	test('an insurance-managed split loads read-only and does not enter group edit', async () => {
		const first = makeExpense('s1', {
			groupId: 'g1',
			category: 'financial',
			tags: ['insurance'],
			amount: 120,
			description: undefined
		});
		expenseApiMock.getExpense.mockResolvedValue(first);
		expenseApiMock.getSplitExpense.mockResolvedValue(makeSplitGroup([first], { groupTotal: 240 }));
		const state = createState('s1');
		await loadExpense(state);
		expect(state.isInsuranceManaged).toBe(true);
		expect(state.isGroupEditMode).toBe(false);
		expect(state.isSplit).toBe(false);
		expect(state.formData).toMatchObject({
			category: 'financial',
			amount: '240',
			tags: ['insurance'],
			description: ''
		});
		expect(state.isLoading).toBe(false);
	});

	test('an empty split group says it no longer exists and navigates back', async () => {
		expenseApiMock.getExpense.mockResolvedValue(makeExpense('s1', { groupId: 'g1' }));
		expenseApiMock.getSplitExpense.mockResolvedValue(makeSplitGroup([]));
		const state = createState('s1');
		await loadExpense(state);
		expect(addNotification).toHaveBeenCalledWith({
			type: 'error',
			message: 'That split expense no longer exists.'
		});
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
		expect(state.isGroupEditMode).toBe(false);
	});

	test('a deleted split group (404) navigates back', async () => {
		expenseApiMock.getExpense.mockResolvedValue(makeExpense('s1', { groupId: 'g1' }));
		expenseApiMock.getSplitExpense.mockRejectedValue(new ApiError('Not found', 404));
		const state = createState('s1');
		await loadExpense(state);
		expect(addNotification).toHaveBeenCalledWith({
			type: 'error',
			message: 'That split expense no longer exists.'
		});
		expect(gotoDynamic).toHaveBeenCalledTimes(1);
	});

	test('a split group server failure stays on the page with an inline error', async () => {
		expenseApiMock.getExpense.mockResolvedValue(makeExpense('s1', { groupId: 'g1' }));
		expenseApiMock.getSplitExpense.mockRejectedValue(new ApiError('Internal server error', 500));
		const state = createState('s1');
		await loadExpense(state);
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(state.expenseError).toBe(SERVER_FAILURE_MESSAGE);
		expect(state.isGroupEditMode).toBe(false);
		expect(state.isLoading).toBe(false);
	});
});

describe('vehicle context loaders', () => {
	test('loadVehicle stores the selected vehicle', async () => {
		vehicleApiMock.getVehicle.mockResolvedValue(makeVehicle('v1', { initialMileage: 100 }));
		const state = createState();
		state.formData.vehicleId = 'v1';
		await loadVehicle(state);
		expect(vehicleApiMock.getVehicle).toHaveBeenCalledWith('v1');
		expect(state.vehicle?.initialMileage).toBe(100);
	});

	test('loadVehicle swallows a failure', async () => {
		vehicleApiMock.getVehicle.mockRejectedValue(new Error('nope'));
		const state = createState();
		await loadVehicle(state);
		expect(state.vehicle).toBeNull();
	});

	test('loadLastFuelExpense skips the expense currently being edited', async () => {
		expenseApiMock.getExpensesByVehicle.mockResolvedValue({
			data: [makeExpense('e1', { mileage: 200 }), makeExpense('e0', { mileage: 100 })]
		});
		const state = createState('e1');
		state.formData.vehicleId = 'v1';
		await loadLastFuelExpense(state);
		expect(expenseApiMock.getExpensesByVehicle).toHaveBeenCalledWith('v1', {
			limit: 2,
			category: 'fuel'
		});
		expect(state.lastFuelExpense?.id).toBe('e0');
	});

	test('loadLastFuelExpense sets null when there is no prior fuel expense', async () => {
		expenseApiMock.getExpensesByVehicle.mockResolvedValue({ data: [] });
		const state = createState();
		await loadLastFuelExpense(state);
		expect(state.lastFuelExpense).toBeNull();
	});

	test('loadLastFuelExpense swallows a failure', async () => {
		expenseApiMock.getExpensesByVehicle.mockRejectedValue(new Error('x'));
		const state = createState();
		await loadLastFuelExpense(state);
		expect(state.lastFuelExpense).toBeNull();
	});

	test('loadAllVehicleExpenses stores up to 100 expenses', async () => {
		expenseApiMock.getExpensesByVehicle.mockResolvedValue({ data: [makeExpense('a')] });
		const state = createState();
		state.formData.vehicleId = 'v1';
		await loadAllVehicleExpenses(state);
		expect(expenseApiMock.getExpensesByVehicle).toHaveBeenCalledWith('v1', { limit: 100 });
		expect(state.allVehicleExpenses.map(e => e.id)).toEqual(['a']);
	});

	test('loadAllVehicleExpenses swallows a failure', async () => {
		expenseApiMock.getExpensesByVehicle.mockRejectedValue(new Error('x'));
		const state = createState();
		await loadAllVehicleExpenses(state);
		expect(state.allVehicleExpenses).toEqual([]);
	});

	test('loadVehicleContext loads the vehicle, last fuel expense and history', async () => {
		vehicleApiMock.getVehicle.mockResolvedValue(makeVehicle('v1'));
		expenseApiMock.getExpensesByVehicle
			.mockResolvedValueOnce({ data: [makeExpense('f1')] })
			.mockResolvedValueOnce({ data: [makeExpense('f1'), makeExpense('m1')] });
		const state = createState();
		state.formData.vehicleId = 'v1';
		await loadVehicleContext(state);
		expect(state.vehicle?.id).toBe('v1');
		expect(state.lastFuelExpense?.id).toBe('f1');
		expect(state.allVehicleExpenses).toHaveLength(2);
	});
});
