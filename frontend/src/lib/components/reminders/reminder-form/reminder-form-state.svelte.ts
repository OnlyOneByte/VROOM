import { SvelteDate } from 'svelte/reactivity';
import { resetSplitAllocations, type SplitAllocationDraft } from '$lib/utils/expense-helpers';
import type { ReminderWithVehicles, Vehicle } from '$lib/types';
import {
	draftFromReminder,
	emptyReminderDraft,
	hasMileageTrigger,
	hasTimeTrigger,
	shouldShowSplitEditor,
	type ReminderDraft,
	type SplitMethod
} from './reminder-form-model';
import { buildReminderPayload, type ReminderPayload } from './reminder-form-payload';
import { validateReminderDraft } from './reminder-form-validation';

export class ReminderFormState {
	values = $state<ReminderDraft>(emptyReminderDraft([], new SvelteDate()));
	errors = $state<Record<string, string>>({});
	isSubmitting = $state(false);

	hasTimeAxis = $derived(hasTimeTrigger(this.values.triggerMode));
	hasMileageAxis = $derived(hasMileageTrigger(this.values.triggerMode));
	showSplitEditor = $derived(shouldShowSplitEditor(this.values));

	load(reminder: ReminderWithVehicles | null, vehicles: Vehicle[]) {
		this.errors = {};
		this.values = reminder
			? draftFromReminder(reminder)
			: emptyReminderDraft(vehicles, new SvelteDate());
	}

	toggleVehicle(vehicleId: string) {
		const ids = this.values.selectedVehicleIds.includes(vehicleId)
			? this.values.selectedVehicleIds.filter(id => id !== vehicleId)
			: [...this.values.selectedVehicleIds, vehicleId];
		this.values.selectedVehicleIds = ids;
		this.values.splitAllocations = resetSplitAllocations(this.values.splitMethod, ids);
	}

	setSplitMethod(method: SplitMethod) {
		this.values.splitMethod = method;
		this.values.splitAllocations = resetSplitAllocations(method, this.values.selectedVehicleIds);
	}

	setSplitAllocations(allocations: SplitAllocationDraft[]) {
		this.values.splitAllocations = allocations;
	}

	validate(): boolean {
		this.errors = validateReminderDraft(this.values);
		return Object.keys(this.errors).length === 0;
	}

	toPayload(): ReminderPayload {
		return buildReminderPayload(this.values);
	}
}
