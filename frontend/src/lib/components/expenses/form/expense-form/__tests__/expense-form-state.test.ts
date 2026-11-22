import { describe, expect, test } from 'vitest';
import { COMMON_EXPENSE_TAGS } from '#lib/types/index.ts';
import { ExpenseFormState } from '../expense-form-state.svelte';
import { makeExpense, makeVehicle } from './expense-form-fixtures';

function createState(expenseId?: string) {
	return new ExpenseFormState({ expenseId, returnTo: '/expenses' }, false);
}

function fillValidFuel(state: ExpenseFormState) {
	state.formData.vehicleId = 'v1';
	state.formData.category = 'fuel';
	state.formData.amount = '45';
	state.formData.date = '2025-03-10';
	state.formData.mileage = '1000';
	state.formData.volume = '10';
}

describe('ExpenseFormState — construction and derived flags', () => {
	test('initial loading flag and edit mode follow the context', () => {
		const create = new ExpenseFormState({ expenseId: undefined, returnTo: '/' }, false);
		const edit = new ExpenseFormState({ expenseId: 'e1', returnTo: '/' }, true);
		expect(create.isLoading).toBe(false);
		expect(create.isEditMode).toBe(false);
		expect(edit.isLoading).toBe(true);
		expect(edit.isEditMode).toBe(true);
	});

	test('canDuplicate only for a plain edit', () => {
		expect(createState().canDuplicate).toBe(false);
		const edit = createState('e1');
		expect(edit.canDuplicate).toBe(true);
		edit.isGroupEditMode = true;
		expect(edit.canDuplicate).toBe(false);
		const insured = createState('e2');
		insured.isInsuranceManaged = true;
		expect(insured.canDuplicate).toBe(false);
	});

	test('parsedTotalAmount falls back to 0 for non-numeric input', () => {
		const state = createState();
		expect(state.parsedTotalAmount).toBe(0);
		state.formData.amount = '12.75';
		expect(state.parsedTotalAmount).toBe(12.75);
	});

	test('tag suggestions list common tags first then unseen historical tags', () => {
		const state = createState();
		state.allVehicleExpenses = [
			makeExpense('a', { tags: ['fuel', 'roadtrip'] }),
			makeExpense('b', { tags: ['roadtrip', 'commute-x'] })
		];
		const suggestions = state.tagSuggestions;
		expect(suggestions.slice(0, COMMON_EXPENSE_TAGS.length)).toEqual([...COMMON_EXPENSE_TAGS]);
		expect(suggestions.filter(t => t === 'fuel')).toHaveLength(1);
		expect(suggestions).toContain('roadtrip');
		expect(suggestions).toContain('commute-x');
	});

	test('unit defaults apply without settings and the vehicle distance unit wins', () => {
		const state = createState();
		expect(state.currencyUnit).toBe('USD');
		expect(state.volumeUnit).toBe('gallons_us');
		expect(state.chargeUnit).toBe('kwh');
		expect(state.effectiveDistanceUnit).toBe('miles');
		expect(state.distLabel).toBe('Miles');
		state.vehicle = makeVehicle('v1', {
			unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
		});
		expect(state.effectiveDistanceUnit).toBe('kilometers');
		expect(state.distLabel).toBe('Kilometers');
	});

	test('previousFuelHint shows the last fuel mileage only for fuel-tagged entries', () => {
		const state = createState();
		state.lastFuelExpense = makeExpense('f', { mileage: 5_000 });
		expect(state.previousFuelHint).toBeNull();
		state.formData.tags = ['fuel'];
		expect(state.previousFuelHint).toBe(5_000);
	});

	test('fuel category toggles volume or charge field by fuel type', () => {
		const state = createState();
		expect(state.showFuelFields).toBe(false);
		state.formData.category = 'fuel';
		expect(state.showVolumeField).toBe(true);
		expect(state.showChargeField).toBe(false);
		state.formData.fuelType = 'Electric';
		expect(state.showVolumeField).toBe(false);
		expect(state.showChargeField).toBe(true);
	});

	test('isFinancingPayment needs both a financing source type and id', () => {
		const state = createState();
		state.sourceType = 'financing';
		expect(state.isFinancingPayment).toBe(false);
		state.sourceId = 'fin-1';
		expect(state.isFinancingPayment).toBe(true);
	});
});

describe('ExpenseFormState — validation', () => {
	test('validateForm requires vehicle, category, amount and date', () => {
		const state = createState();
		state.formData.date = '';
		expect(state.validateForm()).toBe(false);
		expect(Object.keys(state.errors).sort()).toEqual(['amount', 'category', 'date', 'vehicleId']);
	});

	test('group edit mode does not require a vehicle', () => {
		const state = createState('e1');
		state.isGroupEditMode = true;
		state.formData.category = 'misc';
		state.formData.amount = '10';
		state.formData.date = '2025-01-01';
		expect(state.validateForm()).toBe(true);
		expect(state.errors).toEqual({});
	});

	test('fuel expenses also validate mileage and volume', () => {
		const state = createState();
		fillValidFuel(state);
		state.formData.mileage = '';
		state.formData.volume = '';
		expect(state.validateForm()).toBe(false);
		expect(state.errors['mileage']).toBe('Mileage required for fuel expenses');
		expect(state.errors['volume']).toMatch(/required for fuel expenses/);
	});

	test('a non-fuel mileage is checked on save once entered, and never for a split', () => {
		const state = createState();
		state.formData.vehicleId = 'v1';
		state.formData.category = 'maintenance';
		state.formData.amount = '120';
		state.formData.date = '2025-03-10';
		state.allVehicleExpenses = [makeExpense('a', { date: '2025-03-01', mileage: 10_000 })];
		expect(state.validateForm()).toBe(true);

		state.formData.mileage = '9000';
		expect(state.validateForm()).toBe(false);
		expect(state.errors['mileage']).toContain('greater than 10,000');

		state.isSplit = true;
		state.selectedVehicleIds = ['v1', 'v2'];
		expect(state.asksForMileage).toBe(false);
		expect(state.validateForm()).toBe(true);
	});

	test('electric fuel expenses validate charge instead of volume', () => {
		const state = createState();
		fillValidFuel(state);
		state.formData.fuelType = 'Electric';
		state.formData.volume = '';
		state.formData.charge = '';
		expect(state.validateForm()).toBe(false);
		expect(state.errors['charge']).toMatch(/required for charging expenses/);
		expect(state.errors['volume']).toBeUndefined();
	});

	test('a fully valid fuel form passes', () => {
		const state = createState();
		fillValidFuel(state);
		expect(state.validateForm()).toBe(true);
	});

	test('handleBlur records an error then clears it once fixed', () => {
		const state = createState();
		state.handleBlur('amount');
		expect(state.touched['amount']).toBe(true);
		expect(state.errors['amount']).toBe('Amount must be greater than 0');
		state.formData.amount = '5';
		state.handleBlur('amount');
		expect(state.errors['amount']).toBeUndefined();
	});

	test('blurring the date revalidates a filled mileage against earlier entries', () => {
		const state = createState();
		fillValidFuel(state);
		state.allVehicleExpenses = [
			makeExpense('prev', { date: '2025-03-01T12:00:00.000Z', mileage: 2_000 })
		];
		state.handleBlur('date');
		expect(state.touched['mileage']).toBe(true);
		expect(state.errors['mileage']).toMatch(/greater than 2,000/);
	});
});

describe('ExpenseFormState — handlers', () => {
	test('selecting a non-fuel, non-financial category clears fuel fields and source, keeping the mileage', () => {
		const state = createState();
		fillValidFuel(state);
		state.formData.charge = '3';
		state.formData.fuelType = 'Regular';
		state.formData.missedFillup = true;
		state.sourceType = 'financing';
		state.sourceId = 'fin-1';
		state.selectCategory('maintenance');
		expect(state.formData).toMatchObject({
			category: 'maintenance',
			volume: '',
			charge: '',
			fuelType: '',
			mileage: '1000',
			missedFillup: false
		});
		expect(state.sourceType).toBeNull();
		expect(state.sourceId).toBeNull();
		expect(state.touched['category']).toBe(true);
	});

	test('selecting financial keeps the financing source', () => {
		const state = createState();
		state.sourceType = 'financing';
		state.sourceId = 'fin-1';
		state.selectCategory('financial');
		expect(state.sourceId).toBe('fin-1');
	});

	test('selecting fuel keeps entered fuel fields', () => {
		const state = createState();
		state.formData.volume = '9';
		state.selectCategory('fuel');
		expect(state.formData.volume).toBe('9');
	});

	test('handleMileageChange computes MPG from the previous fill-up', () => {
		const state = createState();
		fillValidFuel(state);
		state.lastFuelExpense = makeExpense('prev', { mileage: 700 });
		state.handleMileageChange();
		expect(state.calculatedMpg).toBe(30);
		expect(state.calculatedEfficiency).toBeNull();
		expect(state.showMpgCalculation).toBe(true);
	});

	test('handleMileageChange leaves results untouched without a previous fill-up', () => {
		const state = createState();
		fillValidFuel(state);
		state.calculatedMpg = 11;
		state.handleMileageChange();
		expect(state.calculatedMpg).toBe(11);
		expect(state.showMpgCalculation).toBe(false);
	});

	test('handleVehicleSelect sets and validates the vehicle', () => {
		const state = createState();
		state.handleVehicleSelect('v7');
		expect(state.formData.vehicleId).toBe('v7');
		expect(state.touched['vehicleId']).toBe(true);
		expect(state.errors['vehicleId']).toBeUndefined();
	});

	test('toggling split on seeds it with the current vehicle and off restores the first', () => {
		const state = createState();
		state.formData.vehicleId = 'v1';
		state.handleSplitToggle(true);
		expect(state.isSplit).toBe(true);
		expect(state.selectedVehicleIds).toEqual(['v1']);
		state.handleSplitVehicleToggle('v2');
		state.handleSplitVehicleToggle('v1');
		expect(state.selectedVehicleIds).toEqual(['v2']);
		state.handleSplitToggle(false);
		expect(state.isSplit).toBe(false);
		expect(state.formData.vehicleId).toBe('v2');
		expect(state.selectedVehicleIds).toEqual([]);
	});

	test('toggling split off with no selection keeps the current vehicle', () => {
		const state = createState();
		state.formData.vehicleId = 'v3';
		state.handleSplitToggle(false);
		expect(state.formData.vehicleId).toBe('v3');
	});

	test('changing split method resets allocations for the selected vehicles', () => {
		const state = createState();
		state.selectedVehicleIds = ['v1', 'v2'];
		state.handleMethodChange('percentage');
		expect(state.splitMethod).toBe('percentage');
		expect(state.splitAllocations.map(a => a.vehicleId)).toEqual(['v1', 'v2']);
		state.handleAllocationsChange([{ vehicleId: 'v1', percentage: 100 }]);
		expect(state.splitAllocations).toEqual([{ vehicleId: 'v1', percentage: 100 }]);
	});
});
