import { describe, expect, test } from 'vitest';
import { ExpenseFormState } from '../expense-form-state.svelte';
import { makeVehicle } from './expense-form-fixtures';

function createState(expenseId?: string) {
	const state = new ExpenseFormState({ expenseId, returnTo: '/expenses' }, false);
	state.vehicles = [makeVehicle('v1'), makeVehicle('v2')];
	state.formData.vehicleId = 'v1';
	return state;
}

describe('ExpenseFormState fuel split rules', () => {
	test('split is offered for other categories and hidden for Fuel with a hint', () => {
		const state = createState();
		state.selectCategory('maintenance');
		expect(state.canSplit).toBe(true);
		expect(state.showFuelSplitHint).toBe(false);
		state.selectCategory('fuel');
		expect(state.canSplit).toBe(false);
		expect(state.showFuelSplitHint).toBe(true);
	});

	test('choosing Fuel turns an active split off and keeps the first vehicle', () => {
		const state = createState();
		state.selectCategory('maintenance');
		state.handleSplitToggle(true);
		state.handleSplitVehicleToggle('v2');
		expect(state.isSplit).toBe(true);
		state.selectCategory('fuel');
		expect(state.isSplit).toBe(false);
		expect(state.formData.vehicleId).toBe('v1');
	});

	test('no hint with a single vehicle or on a plain edit', () => {
		const single = createState();
		single.vehicles = [makeVehicle('v1')];
		single.selectCategory('fuel');
		expect(single.showFuelSplitHint).toBe(false);
		const edit = createState('e1');
		edit.selectCategory('fuel');
		expect(edit.showFuelSplitHint).toBe(false);
		expect(edit.canSplit).toBe(false);
	});
});
