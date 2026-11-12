import { buildSplitConfig } from '$lib/utils/expense-helpers';
import { dateOnlyToISO } from '$lib/utils/formatters';
import type { Reminder } from '$lib/types/reminder';
import {
	hasMileageTrigger,
	shouldShowSplitEditor,
	type ReminderDraft
} from './reminder-form-model';

export type ReminderPayload = Partial<Reminder> & { vehicleIds: string[] };

export function buildReminderPayload(draft: ReminderDraft): ReminderPayload {
	const isExpense = draft.kind === 'expense';
	const mileage = hasMileageTrigger(draft.triggerMode);
	return {
		name: draft.name.trim(),
		description: draft.description.trim() || null,
		type: draft.kind,
		triggerMode: draft.triggerMode,
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
		expenseCategory: isExpense ? draft.expenseCategory : null,
		expenseAmount: isExpense ? parseFloat(draft.expenseAmount) : null,
		expenseTags: isExpense && draft.expenseTags.length > 0 ? draft.expenseTags : null,
		expenseSplitConfig:
			isExpense && shouldShowSplitEditor(draft)
				? buildSplitConfig(draft.splitMethod, draft.selectedVehicleIds, draft.splitAllocations)
				: null
	};
}
