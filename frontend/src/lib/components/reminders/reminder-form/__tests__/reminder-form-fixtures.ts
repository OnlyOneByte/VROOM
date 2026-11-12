import type { Vehicle } from '#lib/types/index.ts';
import type { Reminder, ReminderWithVehicles } from '#lib/types/reminder.ts';
import type { ReminderDraft } from '../reminder-form-model';
import { emptyReminderDraft } from '../reminder-form-model';

export function makeVehicle(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
	return {
		id,
		make: 'Honda',
		model: 'Civic',
		year: 2020,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

export function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
	return {
		id: 'rem-1',
		userId: 'user-1',
		name: 'Rotate tires',
		description: null,
		type: 'notification',
		actionMode: 'notify',
		frequency: 'monthly',
		intervalValue: null,
		intervalUnit: null,
		triggerMode: 'time',
		intervalMileage: null,
		lastServiceOdometer: null,
		nextDueOdometer: null,
		startDate: '2026-01-15T12:00:00.000Z',
		endDate: null,
		nextDueDate: null,
		expenseCategory: null,
		expenseTags: null,
		expenseAmount: null,
		expenseDescription: null,
		expenseSplitConfig: null,
		isActive: true,
		lastTriggeredAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

export function makeReminderWithVehicles(
	reminderOverrides: Partial<Reminder> = {},
	vehicleIds: string[] = ['v1']
): ReminderWithVehicles {
	return { reminder: makeReminder(reminderOverrides), vehicleIds };
}

export function validDraft(overrides: Partial<ReminderDraft> = {}): ReminderDraft {
	return {
		...emptyReminderDraft([], new Date('2026-03-01T12:00:00')),
		name: 'Car insurance',
		selectedVehicleIds: ['v1'],
		...overrides
	};
}
