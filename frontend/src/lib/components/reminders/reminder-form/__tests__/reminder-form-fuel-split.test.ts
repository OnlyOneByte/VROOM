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
		expect(FUEL_SPLIT_ERROR).toBe(
			'Fuel can’t be split across vehicles. Pick another category, or select one vehicle.'
		);
		expect(errors['expenseCategory']).toBe(FUEL_SPLIT_ERROR);
	});

	test('a fuel expense reminder on one vehicle passes', () => {
		expect(validateReminderDraft(validDraft(fuelExpense))).toEqual({});
	});
});

describe('serverFieldErrors', () => {
	const apiError = (issues: unknown[]) =>
		new ApiError('Invalid json', 400, { target: 'json', issues });

	test('maps the app’s own validation messages onto fields the form shows', () => {
		const error = apiError([
			{ code: 'custom', path: ['expenseCategory'], message: 'Fuel expenses cannot be split.' },
			{
				code: 'custom',
				path: ['expenseSplitConfig', 'allocations'],
				message: 'Percentage allocations must sum to 100'
			},
			{ code: 'custom', path: ['expenseCategory'], message: 'A second message for the field' }
		]);
		expect(serverFieldErrors(error)).toEqual({
			expenseCategory: 'Fuel expenses cannot be split.',
			split: 'Percentage allocations must sum to 100'
		});
	});

	test('drops raw schema messages and fields the form has no error slot for', () => {
		const error = apiError([
			{
				code: 'too_big',
				path: ['name'],
				message: 'Too big: expected string to have <=100 characters'
			},
			{ code: 'custom', path: ['expenseTags'], message: 'Tag problem' }
		]);
		expect(serverFieldErrors(error)).toEqual({});
	});

	test('returns nothing for errors without validation issues', () => {
		expect(serverFieldErrors(new ApiError('Boom', 500))).toEqual({});
		expect(serverFieldErrors(new Error('offline'))).toEqual({});
	});
});
