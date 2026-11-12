import { describe, expect, test } from 'vitest';
import { validateReminderDraft } from '../reminder-form-validation';
import { validDraft } from './reminder-form-fixtures';

describe('validateReminderDraft', () => {
	test('a named notification on one vehicle has no errors', () => {
		expect(validateReminderDraft(validDraft())).toEqual({});
	});

	test('a blank name blocks the save with a name error', () => {
		const errors = validateReminderDraft(validDraft({ name: '   ' }));
		expect(errors).toEqual({ name: 'Name is required' });
	});

	test('a reminder with no vehicles is rejected', () => {
		const errors = validateReminderDraft(validDraft({ selectedVehicleIds: [] }));
		expect(errors['vehicleIds']).toBe('Select at least one vehicle');
	});

	test('a mileage reminder spanning two vehicles is rejected', () => {
		const errors = validateReminderDraft(
			validDraft({
				triggerMode: 'mileage',
				intervalMileage: '5000',
				selectedVehicleIds: ['v1', 'v2']
			})
		);
		expect(errors['vehicleIds']).toBe('A mileage reminder must track exactly one vehicle');
	});

	test('a mileage trigger requires a positive whole-number distance interval', () => {
		for (const bad of ['', '0', '-5', 'abc']) {
			const errors = validateReminderDraft(
				validDraft({ triggerMode: 'mileage', intervalMileage: bad })
			);
			expect(errors['intervalMileage'], `intervalMileage=${bad}`).toBe(
				'Enter a positive distance interval'
			);
		}
	});

	test('a blank last-serviced odometer is allowed, since the backend defaults it', () => {
		const errors = validateReminderDraft(
			validDraft({ triggerMode: 'mileage', intervalMileage: '5000', lastServiceOdometer: '  ' })
		);
		expect(errors).toEqual({});
	});

	test('a negative last-serviced odometer is rejected but zero is accepted', () => {
		const base = validDraft({ triggerMode: 'mileage', intervalMileage: '5000' });
		expect(
			validateReminderDraft({ ...base, lastServiceOdometer: '-1' })['lastServiceOdometer']
		).toBe('Enter a valid odometer reading');
		expect(validateReminderDraft({ ...base, lastServiceOdometer: '0' })).toEqual({});
	});

	test('a custom frequency requires a positive whole-number interval', () => {
		const errors = validateReminderDraft(validDraft({ frequency: 'custom', intervalValue: '0' }));
		expect(errors['intervalValue']).toBe('Enter a positive interval');
	});

	test('the interval is not checked when the trigger is mileage only', () => {
		const errors = validateReminderDraft(
			validDraft({
				triggerMode: 'mileage',
				intervalMileage: '5000',
				frequency: 'custom',
				intervalValue: '0'
			})
		);
		expect(errors['intervalValue']).toBeUndefined();
	});

	test('an end date on or before the start date is rejected', () => {
		const errors = validateReminderDraft(
			validDraft({ startDate: '2026-03-10', endDate: '2026-03-10' })
		);
		expect(errors['endDate']).toBe('End date must be after the start date');
	});

	test('an expense reminder needs an amount above zero', () => {
		for (const bad of ['', '0', '-3']) {
			const errors = validateReminderDraft(validDraft({ kind: 'expense', expenseAmount: bad }));
			expect(errors['expenseAmount'], `expenseAmount=${bad}`).toBe(
				'Enter an amount greater than 0'
			);
		}
	});

	test('percentage splits must total exactly 100 within a cent of tolerance', () => {
		const split = (percentages: number[]) =>
			validateReminderDraft(
				validDraft({
					kind: 'expense',
					expenseAmount: '100',
					selectedVehicleIds: ['v1', 'v2'],
					splitMethod: 'percentage',
					splitAllocations: percentages.map((percentage, i) => ({
						vehicleId: `v${i + 1}`,
						percentage
					}))
				})
			);

		expect(split([60, 40])['split']).toBeUndefined();
		expect(split([60, 39])['split']).toBe('Split percentages must total 100%');
	});

	test('absolute splits must total the expense amount', () => {
		const errors = validateReminderDraft(
			validDraft({
				kind: 'expense',
				expenseAmount: '100.00',
				selectedVehicleIds: ['v1', 'v2'],
				splitMethod: 'absolute',
				splitAllocations: [
					{ vehicleId: 'v1', amount: 60 },
					{ vehicleId: 'v2', amount: 30 }
				]
			})
		);
		expect(errors['split']).toBe('Split amounts must total the expense amount');
	});

	test('split totals are not checked when the editor is hidden (one vehicle)', () => {
		const errors = validateReminderDraft(
			validDraft({
				kind: 'expense',
				expenseAmount: '100',
				selectedVehicleIds: ['v1'],
				splitMethod: 'percentage',
				splitAllocations: [{ vehicleId: 'v1', percentage: 10 }]
			})
		);
		expect(errors['split']).toBeUndefined();
	});
});
