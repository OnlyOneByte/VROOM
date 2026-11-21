import { describe, expect, test } from 'vitest';
import { ExpenseFormState, FUEL_NEEDS_VEHICLE_ERROR } from '../expense-form-state.svelte';
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
	test('blocks the save on the vehicle field, not on the hidden volume field', () => {
		const state = fuelState();
		expect(state.validateForm()).toBe(false);
		expect(state.errors['vehicleId']).toBe(FUEL_NEEDS_VEHICLE_ERROR);
		expect(state.errors['volume']).toBeUndefined();
	});

	test('validates normally once the vehicle is loaded', () => {
		const state = fuelState();
		state.vehicle = makeVehicle('v1');
		state.vehicleError = null;
		state.formData.volume = '10';
		expect(state.validateForm()).toBe(true);
	});

	test('other categories save without the vehicle details', () => {
		const state = fuelState();
		state.selectCategory('maintenance');
		state.formData.amount = '45';
		expect(state.validateForm()).toBe(true);
	});
});
