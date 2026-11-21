import { describe, expect, test } from 'vitest';
import { ExpenseFormState } from '../expense-form-state.svelte';
import { makeVehicle } from './expense-form-fixtures';

function createFuelState() {
	const state = new ExpenseFormState({ expenseId: undefined, returnTo: '/expenses' }, false);
	state.formData.vehicleId = 'v1';
	state.formData.category = 'fuel';
	return state;
}

describe('ExpenseFormState vehicle units', () => {
	test('volume and charge units fall back to the global settings without a vehicle', () => {
		const state = createFuelState();
		expect(state.effectiveVolumeUnit).toBe('gallons_us');
		expect(state.effectiveChargeUnit).toBe('kwh');
	});

	test("the vehicle's volume and charge units win over the global settings", () => {
		const state = createFuelState();
		state.vehicle = makeVehicle('v1', {
			unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
		});
		expect(state.effectiveVolumeUnit).toBe('liters');
		expect(state.effectiveDistanceUnit).toBe('kilometers');
	});

	test('volume validation names the vehicle unit', () => {
		const state = createFuelState();
		state.vehicle = makeVehicle('v1', {
			unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
		});
		state.handleBlur('volume');
		expect(state.errors['volume']).toBe('Liters required for fuel expenses');
	});
});
