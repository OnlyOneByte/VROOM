import {
	hasMileageTrigger,
	hasTimeTrigger,
	shouldShowSplitEditor,
	type ReminderDraft
} from './reminder-form-model';

export function validateReminderDraft(draft: ReminderDraft): Record<string, string> {
	const e: Record<string, string> = {};
	const mileage = hasMileageTrigger(draft.triggerMode);
	if (!draft.name.trim()) e['name'] = 'Name is required';
	if (draft.selectedVehicleIds.length === 0) e['vehicleIds'] = 'Select at least one vehicle';
	if (mileage && draft.selectedVehicleIds.length > 1) {
		e['vehicleIds'] = 'A mileage reminder must track exactly one vehicle';
	}
	if (hasTimeTrigger(draft.triggerMode) && draft.frequency === 'custom') {
		const n = parseInt(draft.intervalValue, 10);
		if (!Number.isInteger(n) || n < 1) e['intervalValue'] = 'Enter a positive interval';
	}
	if (mileage) {
		const m = parseInt(draft.intervalMileage, 10);
		if (!Number.isInteger(m) || m < 1) e['intervalMileage'] = 'Enter a positive distance interval';
		if (draft.lastServiceOdometer.trim() !== '') {
			const last = parseInt(draft.lastServiceOdometer, 10);
			if (!Number.isInteger(last) || last < 0) {
				e['lastServiceOdometer'] = 'Enter a valid odometer reading';
			}
		}
	}
	if (draft.endDate && draft.startDate && new Date(draft.endDate) <= new Date(draft.startDate)) {
		e['endDate'] = 'End date must be after the start date';
	}
	if (draft.kind === 'expense') {
		const amt = parseFloat(draft.expenseAmount);
		if (!(amt > 0)) e['expenseAmount'] = 'Enter an amount greater than 0';
		const showSplit = shouldShowSplitEditor(draft);
		if (showSplit && draft.splitMethod === 'percentage') {
			const sum = draft.splitAllocations.reduce((s, a) => s + (a.percentage ?? 0), 0);
			if (Math.abs(sum - 100) > 0.01) e['split'] = 'Split percentages must total 100%';
		}
		if (showSplit && draft.splitMethod === 'absolute' && amt > 0) {
			const sum = draft.splitAllocations.reduce((s, a) => s + (a.amount ?? 0), 0);
			if (Math.abs(sum - amt) > 0.01) e['split'] = 'Split amounts must total the expense amount';
		}
	}
	return e;
}
