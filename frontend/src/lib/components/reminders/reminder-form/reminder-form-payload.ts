import { buildSplitConfig } from '$lib/utils/expense-helpers';
import { dateOnlyToISO } from '$lib/utils/formatters';
import type { Reminder } from '$lib/types/reminder';
import {
	hasMileageTrigger,
	shouldShowSplitEditor,
	type ReminderDraft
} from './reminder-form-model';

export type ReminderPayload = Partial<Reminder> & { vehicleIds: string[] };

// Expects a draft that already passed validateReminderDraft.
export function buildReminderPayload(draft: ReminderDraft): ReminderPayload {
	const isExpense = draft.kind === 'expense';
	const mileage = hasMileageTrigger(draft.triggerMode);
	return {
		name: draft.name.trim(),
		description: draft.description.trim() || null,
		type: draft.kind,
		triggerMode: draft.triggerMode,
		// Omit lastServiceOdometer when blank so the backend defaults it to the vehicle's current odometer.
		intervalMileage: mileage ? parseInt(draft.intervalMileage, 10) : null,
		...(mileage && draft.lastServiceOdometer.trim() !== ''
			? { lastServiceOdometer: parseInt(draft.lastServiceOdometer, 10) }
			: {}),
		frequency: draft.frequency,
		intervalValue: draft.frequency === 'custom' ? parseInt(draft.intervalValue, 10) : null,
		intervalUnit: draft.frequency === 'custom' ? draft.intervalUnit : null,
		startDate: dateOnlyToISO(draft.startDate),
		endDate: draft.endDate ? dateOnlyToISO(draft.endDate) : null,
		vehicleIds: draft.selectedVehicleIds,
		// Expense template: sent only for expense reminders; explicitly null on
		// a notification reminder so switching type on edit clears stale values.
		expenseCategory: isExpense ? draft.expenseCategory : null,
		expenseAmount: isExpense ? parseFloat(draft.expenseAmount) : null,
		expenseTags: isExpense && draft.expenseTags.length > 0 ? draft.expenseTags : null,
		// Explicit null clears a stale split config when the reminder drops back to one vehicle or to a notification.
		expenseSplitConfig:
			isExpense && shouldShowSplitEditor(draft)
				? buildSplitConfig(draft.splitMethod, draft.selectedVehicleIds, draft.splitAllocations)
				: null
	};
}
