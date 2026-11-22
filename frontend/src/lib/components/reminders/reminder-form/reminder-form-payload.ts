import { buildSplitConfig } from '#lib/utils/expense-helpers.ts';
import { toDateInputValue } from '#lib/utils/formatters.ts';
import type { Reminder } from '#lib/types/reminder.ts';
import {
	hasMileageTrigger,
	hasTimeTrigger,
	shouldShowSplitEditor,
	type ReminderDraft
} from './reminder-form-model';

export type ReminderPayload = Partial<Reminder> & { vehicleIds: string[]; timeZone?: string };

function browserTimeZone(): string | undefined {
	try {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		return typeof zone === 'string' && zone !== '' ? zone : undefined;
	} catch {
		return undefined;
	}
}

export function buildReminderPayload(draft: ReminderDraft): ReminderPayload {
	const isExpense = draft.kind === 'expense';
	const mileage = hasMileageTrigger(draft.triggerMode);
	const timeZone = browserTimeZone();
	const timeAxis = hasTimeTrigger(draft.triggerMode);
	const customInterval = timeAxis && draft.frequency === 'custom';
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
		intervalValue: customInterval ? parseInt(draft.intervalValue, 10) : null,
		intervalUnit: customInterval ? draft.intervalUnit : null,
		startDate: draft.startDate || toDateInputValue(new Date()),
		endDate: timeAxis ? draft.endDate || null : null,
		...(timeZone ? { timeZone } : {}),
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
