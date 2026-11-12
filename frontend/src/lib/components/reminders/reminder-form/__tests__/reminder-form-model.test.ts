import { describe, expect, test } from 'vitest';
import {
	draftFromReminder,
	emptyReminderDraft,
	hasMileageTrigger,
	hasTimeTrigger,
	mileageUnitLabel,
	shouldShowSplitEditor
} from '../reminder-form-model';
import { makeReminderWithVehicles, makeVehicle, validDraft } from './reminder-form-fixtures';

describe('emptyReminderDraft', () => {
	test('preselects the only vehicle when the account has exactly one', () => {
		const draft = emptyReminderDraft([makeVehicle('v1')], new Date('2026-03-01T12:00:00'));
		expect(draft.selectedVehicleIds).toEqual(['v1']);
		expect(draft.startDate).toBe('2026-03-01');
	});

	test('preselects nothing when there are several vehicles', () => {
		const draft = emptyReminderDraft(
			[makeVehicle('v1'), makeVehicle('v2')],
			new Date('2026-03-01T12:00:00')
		);
		expect(draft.selectedVehicleIds).toEqual([]);
	});

	test('starts as a monthly time-triggered notification with an even split', () => {
		const draft = emptyReminderDraft([], new Date('2026-03-01T12:00:00'));
		expect(draft).toMatchObject({
			kind: 'notification',
			triggerMode: 'time',
			frequency: 'monthly',
			splitMethod: 'even',
			splitAllocations: [],
			expenseCategory: 'financial'
		});
	});
});

describe('draftFromReminder', () => {
	test('maps stored numeric fields back to input strings and keeps null as blank', () => {
		const draft = draftFromReminder(
			makeReminderWithVehicles({
				triggerMode: 'both',
				intervalMileage: 5000,
				lastServiceOdometer: null,
				frequency: 'custom',
				intervalValue: 3,
				intervalUnit: 'month'
			})
		);
		expect(draft).toMatchObject({
			triggerMode: 'both',
			intervalMileage: '5000',
			lastServiceOdometer: '',
			frequency: 'custom',
			intervalValue: '3',
			intervalUnit: 'month'
		});
	});

	test('coerces unknown trigger, frequency, unit, and category values to safe defaults', () => {
		const draft = draftFromReminder(
			makeReminderWithVehicles({
				triggerMode: 'weird' as 'time',
				frequency: 'hourly' as 'monthly',
				intervalUnit: 'fortnight' as 'month',
				expenseCategory: 'boats'
			})
		);
		expect(draft).toMatchObject({
			triggerMode: 'time',
			frequency: 'monthly',
			intervalUnit: 'month',
			expenseCategory: 'financial'
		});
	});

	test('reads an expense reminder as kind expense with its template', () => {
		const draft = draftFromReminder(
			makeReminderWithVehicles(
				{
					type: 'expense',
					expenseCategory: 'maintenance',
					expenseAmount: 250,
					expenseTags: ['tires']
				},
				['v1', 'v2']
			)
		);
		expect(draft).toMatchObject({
			kind: 'expense',
			expenseCategory: 'maintenance',
			expenseAmount: '250',
			expenseTags: ['tires'],
			selectedVehicleIds: ['v1', 'v2']
		});
	});

	test('seeds absolute allocations as copies so editing the draft does not touch the source', () => {
		const allocation = { vehicleId: 'v1', amount: 60 };
		const draft = draftFromReminder(
			makeReminderWithVehicles({
				type: 'expense',
				expenseSplitConfig: { method: 'absolute', allocations: [allocation] }
			})
		);

		expect(draft.splitMethod).toBe('absolute');
		expect(draft.splitAllocations).toEqual([allocation]);
		expect(draft.splitAllocations[0]).not.toBe(allocation);
	});

	test('an even or missing stored split seeds the even method with no allocations', () => {
		const even = draftFromReminder(
			makeReminderWithVehicles({
				type: 'expense',
				expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] }
			})
		);
		expect(even.splitMethod).toBe('even');
		expect(even.splitAllocations).toEqual([]);

		const none = draftFromReminder(makeReminderWithVehicles({ expenseSplitConfig: null }));
		expect(none.splitMethod).toBe('even');
	});
});

describe('trigger and split predicates', () => {
	test('time and mileage axes follow the trigger mode, with both enabling each', () => {
		expect(hasTimeTrigger('time')).toBe(true);
		expect(hasTimeTrigger('mileage')).toBe(false);
		expect(hasTimeTrigger('both')).toBe(true);
		expect(hasMileageTrigger('time')).toBe(false);
		expect(hasMileageTrigger('mileage')).toBe(true);
		expect(hasMileageTrigger('both')).toBe(true);
	});

	test('the split editor shows only for an expense over two or more vehicles with a positive amount', () => {
		const multi = {
			selectedVehicleIds: ['v1', 'v2'],
			expenseAmount: '100',
			kind: 'expense' as const
		};
		expect(shouldShowSplitEditor(validDraft(multi))).toBe(true);
		expect(shouldShowSplitEditor(validDraft({ ...multi, kind: 'notification' }))).toBe(false);
		expect(shouldShowSplitEditor(validDraft({ ...multi, selectedVehicleIds: ['v1'] }))).toBe(false);
		expect(shouldShowSplitEditor(validDraft({ ...multi, expenseAmount: '0' }))).toBe(false);
		expect(shouldShowSplitEditor(validDraft({ ...multi, expenseAmount: '' }))).toBe(false);
	});
});

describe('mileageUnitLabel', () => {
	const vehicles = [
		makeVehicle('v1', {
			unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
		}),
		makeVehicle('v2')
	];

	test('labels with the selected vehicle distance unit', () => {
		expect(mileageUnitLabel(vehicles, 'v1')).toBe('km');
	});

	test('falls back to miles when the vehicle has no unit preference', () => {
		expect(mileageUnitLabel(vehicles, 'v2')).toBe('mi');
	});

	test('falls back to miles when no vehicle is selected yet', () => {
		expect(mileageUnitLabel(vehicles, undefined)).toBe('mi');
	});
});
