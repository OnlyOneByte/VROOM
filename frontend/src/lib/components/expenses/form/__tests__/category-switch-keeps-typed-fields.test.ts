import { describe, expect, test } from 'vitest';
import { ExpenseFormState } from '../expense-form/expense-form-state.svelte';
import { buildExpenseData } from '../expense-form/expense-payload';

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

const PAYLOAD_CTX = { currency: 'USD', sourceType: null, sourceId: null };

describe('category switch keeps what was typed, and the save drops what does not apply', () => {
	test('switching away from fuel keeps the fuel fields on the form, so switching back restores them', () => {
		const state = fuelEntry();

		state.selectCategory('misc');
		state.selectCategory('fuel');

		expect(state.formData).toMatchObject({
			category: 'fuel',
			volume: '10.5',
			charge: '40',
			fuelType: '87 (Regular)',
			mileage: '1200',
			missedFillup: true
		});
	});

	test('a non-fuel save sends no volume, charge, fuel type or missed fill-up, but keeps the mileage', () => {
		const state = fuelEntry();
		state.selectCategory('misc');

		expect(buildExpenseData(state.formData, PAYLOAD_CTX)).toMatchObject({
			category: 'misc',
			volume: undefined,
			charge: undefined,
			fuelType: undefined,
			mileage: 1200,
			missedFillup: false
		});
	});

	test('a fuel save sends the fuel fields', () => {
		const state = fuelEntry();
		state.formData.charge = '';

		expect(buildExpenseData(state.formData, PAYLOAD_CTX)).toMatchObject({
			volume: 10.5,
			fuelType: '87 (Regular)',
			missedFillup: true
		});
	});

	test('a financing link is sent only while the category is Financial', () => {
		const state = fuelEntry();
		const ctx = { currency: 'USD', sourceType: 'financing', sourceId: 'f1' };
		state.formData.category = 'financial';
		expect(buildExpenseData(state.formData, ctx)).toMatchObject({
			sourceType: 'financing',
			sourceId: 'f1'
		});
		state.formData.category = 'misc';
		expect(buildExpenseData(state.formData, ctx)).toMatchObject({
			sourceType: undefined,
			sourceId: undefined
		});
		expect(
			buildExpenseData(state.formData, { currency: 'USD', sourceType: 'reminder', sourceId: 'r1' })
		).toMatchObject({ sourceType: 'reminder', sourceId: 'r1' });
	});
});
