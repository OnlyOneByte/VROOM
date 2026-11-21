import { describe, expect, test } from 'vitest';
import { ExpenseFormState } from '../expense-form-state.svelte';
import { makeVehicle } from './expense-form-fixtures';

function fuelState() {
	const state = new ExpenseFormState({ expenseId: undefined, returnTo: '/expenses' }, false);
	state.formData.vehicleId = 'v1';
	state.formData.category = 'fuel';
	state.formData.amount = '45';
	state.formData.date = '2025-03-10';
	state.formData.mileage = '1000';
	state.vehicleError = 'offline';
	return state;
}

describe('a Fuel expense whose vehicle failed to load', () => {
	test('blocks an empty fill-up without an error on a hidden field', () => {
		const state = fuelState();
		expect(state.validateForm()).toBe(false);
		expect(state.errors['volume']).toBeUndefined();
		expect(state.errors['vehicleId']).toBeUndefined();
		expect(state.errors['vehicleDetails']).toBeDefined();
	});

	test('still saves a stored fill-up being edited', () => {
		const state = fuelState();
		state.formData.volume = '10';
		expect(state.validateForm()).toBe(true);
	});

	test('validates normally once the vehicle is loaded', () => {
		const state = fuelState();
		state.vehicle = makeVehicle('v1');
		state.vehicleError = null;
		expect(state.validateForm()).toBe(false);
		expect(state.errors['volume']).toBeDefined();
	});

	test('other categories save without the vehicle details', () => {
		const state = fuelState();
		state.selectCategory('maintenance');
		state.formData.amount = '45';
		expect(state.validateForm()).toBe(true);
	});
});
