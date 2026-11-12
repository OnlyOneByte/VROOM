import { describe, expect, test } from 'vitest';
import { toDateInputValue } from '#lib/utils/formatters.ts';
import { buildReminderPayload } from '../reminder-form-payload';
import { validDraft } from './reminder-form-fixtures';

describe('buildReminderPayload', () => {
	test('a notification sends explicit nulls for every expense and schedule-only field', () => {
		const payload = buildReminderPayload(validDraft({ name: '  Rotate tires  ' }));

		expect(payload).toMatchObject({
			name: 'Rotate tires',
			description: null,
			type: 'notification',
			triggerMode: 'time',
			intervalMileage: null,
			frequency: 'monthly',
			intervalValue: null,
			intervalUnit: null,
			endDate: null,
			vehicleIds: ['v1'],
			expenseCategory: null,
			expenseAmount: null,
			expenseTags: null,
			expenseSplitConfig: null
		});
	});

	test('start date round-trips as the same calendar day regardless of timezone', () => {
		const payload = buildReminderPayload(validDraft({ startDate: '2026-03-01' }));
		expect(toDateInputValue(payload.startDate ?? '')).toBe('2026-03-01');
	});

	test('a custom frequency sends the parsed interval and unit; other frequencies send nulls', () => {
		expect(
			buildReminderPayload(
				validDraft({ frequency: 'custom', intervalValue: '3', intervalUnit: 'week' })
			)
		).toMatchObject({ intervalValue: 3, intervalUnit: 'week' });

		expect(
			buildReminderPayload(
				validDraft({ frequency: 'yearly', intervalValue: '3', intervalUnit: 'week' })
			)
		).toMatchObject({ intervalValue: null, intervalUnit: null });
	});

	test('mileage triggers send the parsed interval and omit a blank last-serviced odometer', () => {
		const payload = buildReminderPayload(
			validDraft({ triggerMode: 'mileage', intervalMileage: '5000', lastServiceOdometer: ' ' })
		);
		expect(payload.intervalMileage).toBe(5000);
		expect(payload).not.toHaveProperty('lastServiceOdometer');
	});

	test('a set last-serviced odometer is sent as an integer', () => {
		const payload = buildReminderPayload(
			validDraft({ triggerMode: 'both', intervalMileage: '5000', lastServiceOdometer: '42000' })
		);
		expect(payload.lastServiceOdometer).toBe(42000);
	});

	test('a time-only trigger drops mileage values even when the draft still holds them', () => {
		const payload = buildReminderPayload(
			validDraft({ triggerMode: 'time', intervalMileage: '5000', lastServiceOdometer: '42000' })
		);
		expect(payload.intervalMileage).toBeNull();
		expect(payload).not.toHaveProperty('lastServiceOdometer');
	});

	test('an expense reminder sends its template and tags', () => {
		const payload = buildReminderPayload(
			validDraft({
				kind: 'expense',
				expenseCategory: 'financial',
				expenseAmount: '129.5',
				expenseTags: ['insurance']
			})
		);
		expect(payload).toMatchObject({
			type: 'expense',
			expenseCategory: 'financial',
			expenseAmount: 129.5,
			expenseTags: ['insurance'],
			expenseSplitConfig: null
		});
	});

	test('an expense reminder with no tags sends null tags', () => {
		const payload = buildReminderPayload(
			validDraft({ kind: 'expense', expenseAmount: '10', expenseTags: [] })
		);
		expect(payload.expenseTags).toBeNull();
	});

	test('a multi-vehicle expense sends an even split config listing the vehicles', () => {
		const payload = buildReminderPayload(
			validDraft({
				kind: 'expense',
				expenseAmount: '100',
				selectedVehicleIds: ['v1', 'v2'],
				splitMethod: 'even'
			})
		);
		expect(payload.expenseSplitConfig).toEqual({ method: 'even', vehicleIds: ['v1', 'v2'] });
	});

	test('a multi-vehicle expense sends its absolute allocations', () => {
		const payload = buildReminderPayload(
			validDraft({
				kind: 'expense',
				expenseAmount: '100',
				selectedVehicleIds: ['v1', 'v2'],
				splitMethod: 'absolute',
				splitAllocations: [
					{ vehicleId: 'v1', amount: 60 },
					{ vehicleId: 'v2', amount: 40 }
				]
			})
		);
		expect(payload.expenseSplitConfig).toEqual({
			method: 'absolute',
			allocations: [
				{ vehicleId: 'v1', amount: 60 },
				{ vehicleId: 'v2', amount: 40 }
			]
		});
	});

	test('a single-vehicle expense clears any stale split config to null', () => {
		const payload = buildReminderPayload(
			validDraft({
				kind: 'expense',
				expenseAmount: '100',
				selectedVehicleIds: ['v1'],
				splitMethod: 'percentage',
				splitAllocations: [{ vehicleId: 'v1', percentage: 100 }]
			})
		);
		expect(payload.expenseSplitConfig).toBeNull();
	});

	test('a multi-vehicle notification never sends a split config', () => {
		const payload = buildReminderPayload(
			validDraft({ selectedVehicleIds: ['v1', 'v2'], splitMethod: 'even' })
		);
		expect(payload.expenseSplitConfig).toBeNull();
	});
});
