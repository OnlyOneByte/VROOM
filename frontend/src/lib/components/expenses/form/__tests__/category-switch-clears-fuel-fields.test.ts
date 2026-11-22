import { describe, expect, test } from 'vitest';
import { ExpenseFormState } from '../expense-form/expense-form-state.svelte';

function fuelEntry(): ExpenseFormState {
	const state = new ExpenseFormState({ expenseId: undefined, returnTo: '/expenses' }, false);
	state.formData.category = 'fuel';
	state.formData.volume = '10.5';
	state.formData.charge = '40';
	state.formData.fuelType = '87 (Regular)';
	state.formData.mileage = '1200';
	state.formData.missedFillup = true;
	return state;
}

describe('category switch clears fuel fields', () => {
	test('switching away from fuel clears volume, charge, fuelType and missedFillup, keeping the mileage', () => {
		const state = fuelEntry();

		state.selectCategory('misc');

		expect(state.formData).toMatchObject({
			category: 'misc',
			volume: '',
			charge: '',
			fuelType: '',
			mileage: '1200',
			missedFillup: false
		});
	});

	test('re-selecting fuel keeps the fuel fields', () => {
		const state = fuelEntry();

		state.selectCategory('fuel');

		expect(state.formData).toMatchObject({
			volume: '10.5',
			charge: '40',
			fuelType: '87 (Regular)'
		});
	});
});
