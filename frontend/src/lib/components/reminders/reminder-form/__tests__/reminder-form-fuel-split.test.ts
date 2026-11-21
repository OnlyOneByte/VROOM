import { describe, expect, test } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';
import { FUEL_SPLIT_ERROR, isFuelAllowed } from '../reminder-form-model';
import { serverFieldErrors, validateReminderDraft } from '../reminder-form-validation';
import { validDraft } from './reminder-form-fixtures';

const fuelExpense = {
	kind: 'expense' as const,
	expenseCategory: 'fuel' as const,
	expenseAmount: '40'
};

describe('fuel on a reminder that spans vehicles', () => {
	test('fuel is offered for one vehicle and not for two or more', () => {
		expect(isFuelAllowed(validDraft({ selectedVehicleIds: ['v1'] }))).toBe(true);
		expect(isFuelAllowed(validDraft({ selectedVehicleIds: ['v1', 'v2'] }))).toBe(false);
	});

	test('a fuel expense reminder on two vehicles is blocked on the category field', () => {
		const errors = validateReminderDraft(
			validDraft({ ...fuelExpense, selectedVehicleIds: ['v1', 'v2'] })
		);
		expect(errors['expenseCategory']).toBe(FUEL_SPLIT_ERROR);
	});

	test('a fuel expense reminder on one vehicle passes', () => {
		expect(validateReminderDraft(validDraft(fuelExpense))).toEqual({});
	});
});

describe('serverFieldErrors', () => {
	test('maps the server validation issues onto the form fields', () => {
		const error = new ApiError('Invalid json', 400, {
			target: 'json',
			issues: [
				{ path: ['expenseCategory'], message: 'Fuel expenses cannot be split.' },
				{ path: ['expenseSplitConfig', 'allocations'], message: 'Allocations must sum to 100' },
				{ path: ['expenseCategory'], message: 'A second message for the same field' }
			]
		});
		expect(serverFieldErrors(error)).toEqual({
			expenseCategory: 'Fuel expenses cannot be split.',
			split: 'Allocations must sum to 100'
		});
	});

	test('returns nothing for errors without validation issues', () => {
		expect(serverFieldErrors(new ApiError('Boom', 500))).toEqual({});
		expect(serverFieldErrors(new Error('offline'))).toEqual({});
	});
});
