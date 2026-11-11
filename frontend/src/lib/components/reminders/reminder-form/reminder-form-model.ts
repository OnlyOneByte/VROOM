import { toDateInputValue } from '$lib/utils/formatters';
import { getDistanceUnitLabel } from '$lib/utils/units';
import type { SplitAllocationDraft } from '$lib/utils/expense-helpers';
import type { ExpenseCategory, ReminderWithVehicles, Vehicle } from '$lib/types';
import type { TriggerMode } from '$lib/types/reminder';

export const FREQUENCIES = ['weekly', 'monthly', 'yearly', 'custom'] as const;
export const INTERVAL_UNITS = ['day', 'week', 'month', 'year'] as const;
export const EXPENSE_CATEGORIES = [
	'fuel',
	'maintenance',
	'financial',
	'regulatory',
	'enhancement',
	'misc'
] as const satisfies readonly ExpenseCategory[];

export type Frequency = (typeof FREQUENCIES)[number];
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];
export type ReminderKind = 'notification' | 'expense';
export type SplitMethod = 'even' | 'absolute' | 'percentage';

// Plain snapshot of every field the form edits. Numeric inputs stay strings until validation/payload.
export interface ReminderDraft {
	kind: ReminderKind;
	name: string;
	description: string;
	triggerMode: TriggerMode;
	intervalMileage: string;
	lastServiceOdometer: string;
	frequency: Frequency;
	intervalValue: string;
	intervalUnit: IntervalUnit;
	startDate: string;
	endDate: string;
	selectedVehicleIds: string[];
	expenseCategory: ExpenseCategory;
	expenseAmount: string;
	expenseTags: string[];
	// 'even' stores no per-vehicle rows (the backend splits cents); absolute and percentage store allocations.
	splitMethod: SplitMethod;
	splitAllocations: SplitAllocationDraft[];
}

export function emptyReminderDraft(vehicles: Vehicle[], today: Date): ReminderDraft {
	return {
		kind: 'notification',
		name: '',
		description: '',
		triggerMode: 'time',
		intervalMileage: '',
		lastServiceOdometer: '',
		frequency: 'monthly',
		intervalValue: '',
		intervalUnit: 'month',
		startDate: toDateInputValue(today),
		endDate: '',
		selectedVehicleIds: vehicles.length === 1 && vehicles[0] ? [vehicles[0].id] : [],
		expenseCategory: 'financial',
		expenseAmount: '',
		expenseTags: [],
		splitMethod: 'even',
		splitAllocations: []
	};
}

export function draftFromReminder(reminder: ReminderWithVehicles): ReminderDraft {
	const r = reminder.reminder;
	// Seed the split editor from the stored config: 'even' has no per-vehicle rows; absolute/
	// percentage carry their allocations. A null config (single-vehicle / unsplit) defaults to even.
	const split = r.expenseSplitConfig?.method === 'even' ? null : r.expenseSplitConfig;

	return {
		kind: r.type === 'expense' ? 'expense' : 'notification',
		name: r.name,
		description: r.description ?? '',
		triggerMode: (['time', 'mileage', 'both'] as const).includes(r.triggerMode as TriggerMode)
			? (r.triggerMode as TriggerMode)
			: 'time',
		intervalMileage: r.intervalMileage != null ? String(r.intervalMileage) : '',
		lastServiceOdometer: r.lastServiceOdometer != null ? String(r.lastServiceOdometer) : '',
		frequency: (FREQUENCIES as readonly string[]).includes(r.frequency)
			? (r.frequency as Frequency)
			: 'monthly',
		intervalValue: r.intervalValue != null ? String(r.intervalValue) : '',
		intervalUnit: (INTERVAL_UNITS as readonly string[]).includes(r.intervalUnit ?? '')
			? (r.intervalUnit as IntervalUnit)
			: 'month',
		startDate: toDateInputValue(r.startDate),
		endDate: r.endDate ? toDateInputValue(r.endDate) : '',
		selectedVehicleIds: [...reminder.vehicleIds],
		expenseCategory: (EXPENSE_CATEGORIES as readonly string[]).includes(r.expenseCategory ?? '')
			? (r.expenseCategory as ExpenseCategory)
			: 'financial',
		expenseAmount: r.expenseAmount != null ? String(r.expenseAmount) : '',
		expenseTags: r.expenseTags ? [...r.expenseTags] : [],
		splitMethod: split ? split.method : 'even',
		splitAllocations: split ? split.allocations.map(a => ({ ...a })) : []
	};
}

export function hasTimeTrigger(mode: TriggerMode): boolean {
	return mode === 'time' || mode === 'both';
}

export function hasMileageTrigger(mode: TriggerMode): boolean {
	return mode === 'mileage' || mode === 'both';
}

export function parsedExpenseAmount(amount: string): number {
	return parseFloat(amount) || 0;
}

// The split editor is only relevant for an expense reminder spanning ≥2 vehicles with a positive
// amount; a single-vehicle expense reminder keeps the no-split (null config) path unchanged.
export function shouldShowSplitEditor(draft: ReminderDraft): boolean {
	return (
		draft.kind === 'expense' &&
		parsedExpenseAmount(draft.expenseAmount) > 0 &&
		draft.selectedVehicleIds.length >= 2
	);
}

// The distance-unit label of the single selected vehicle (mileage requires exactly one). Falls
// back to 'miles' when no vehicle is resolved yet.
export function mileageUnitLabel(
	vehicles: Vehicle[],
	selectedVehicleId: string | undefined
): string {
	const v = vehicles.find(veh => veh.id === selectedVehicleId);
	return getDistanceUnitLabel(v?.unitPreferences?.distanceUnit ?? 'miles', true);
}
