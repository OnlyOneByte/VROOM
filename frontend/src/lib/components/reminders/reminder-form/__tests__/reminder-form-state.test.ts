import { describe, expect, test } from 'vitest';
import { ReminderFormState } from '../reminder-form-state.svelte';
import { makeReminderWithVehicles, makeVehicle } from './reminder-form-fixtures';

describe('ReminderFormState', () => {
	test('load on a new reminder preselects the only vehicle and clears stale errors', () => {
		const form = new ReminderFormState();
		form.errors = { name: 'Name is required' };

		form.load(null, [makeVehicle('v1')]);

		expect(form.errors).toEqual({});
		expect(form.values.selectedVehicleIds).toEqual(['v1']);
	});

	test('load on an existing reminder replaces every field with the stored values', () => {
		const form = new ReminderFormState();
		form.load(makeReminderWithVehicles({ name: 'Insurance', type: 'expense' }, ['v1', 'v2']), [
			makeVehicle('v1'),
			makeVehicle('v2')
		]);

		expect(form.values).toMatchObject({
			kind: 'expense',
			name: 'Insurance',
			selectedVehicleIds: ['v1', 'v2']
		});
	});

	test('toggling a vehicle on and off updates the selection', () => {
		const form = new ReminderFormState();
		form.load(null, [makeVehicle('v1'), makeVehicle('v2')]);

		form.toggleVehicle('v2');
		expect(form.values.selectedVehicleIds).toEqual(['v2']);

		form.toggleVehicle('v2');
		expect(form.values.selectedVehicleIds).toEqual([]);
	});

	test('changing the vehicle set rebuilds absolute allocations as zeroed rows', () => {
		const form = new ReminderFormState();
		form.load(null, [makeVehicle('v1'), makeVehicle('v2')]);
		form.setSplitMethod('absolute');

		form.toggleVehicle('v1');
		form.toggleVehicle('v2');

		expect(form.values.splitAllocations).toEqual([
			{ vehicleId: 'v1', amount: 0 },
			{ vehicleId: 'v2', amount: 0 }
		]);
	});

	test('switching to percentage spreads 100 evenly across the selected vehicles', () => {
		const form = new ReminderFormState();
		form.load(null, [makeVehicle('v1'), makeVehicle('v2'), makeVehicle('v3')]);
		form.toggleVehicle('v2');
		form.toggleVehicle('v3');

		form.setSplitMethod('percentage');

		expect(form.values.splitMethod).toBe('percentage');
		expect(form.values.splitAllocations.map(a => a.percentage)).toEqual([50, 50]);
	});

	test('the time and mileage axes follow the trigger mode', () => {
		const form = new ReminderFormState();
		form.load(null, [makeVehicle('v1')]);
		expect(form.hasTimeAxis).toBe(true);
		expect(form.hasMileageAxis).toBe(false);

		form.values.triggerMode = 'both';
		expect(form.hasTimeAxis).toBe(true);
		expect(form.hasMileageAxis).toBe(true);
	});

	test('validate records errors and reports whether the draft may be saved', () => {
		const form = new ReminderFormState();
		form.load(null, [makeVehicle('v1')]);

		expect(form.validate()).toBe(false);
		expect(form.errors).toEqual({ name: 'Name is required' });

		form.values.name = 'Rotate tires';
		expect(form.validate()).toBe(true);
		expect(form.errors).toEqual({});
	});

	test('toPayload builds the request body from the current draft', () => {
		const form = new ReminderFormState();
		form.load(null, [makeVehicle('v1')]);
		form.values.name = '  Rotate tires ';

		expect(form.toPayload()).toMatchObject({ name: 'Rotate tires', vehicleIds: ['v1'] });
	});
});
